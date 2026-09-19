import { BrokerConnection, IngestionEvent, BrokerAccount } from './src/types';
import crypto from 'node:crypto';

const TRADOVATE_API_URL = 'https://live.tradovateapi.com/v1';
const TRADOVATE_AUTH_URL = 'https://live.tradovateapi.com/v1/auth';

export interface TradovateTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  userId?: string;
}

export class TradovateService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    this.clientId = process.env.TRADOVATE_CLIENT_ID || '';
    this.clientSecret = process.env.TRADOVATE_CLIENT_SECRET || '';
    this.redirectUri = process.env.APP_URL ? `${process.env.APP_URL}/api/auth/tradovate/callback` : '';
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.redirectUri);
  }

  getAuthorizationUrl(state: string): string {
    if (!this.isConfigured()) {
      throw new Error('Tradovate OAuth is not configured. Missing TRADOVATE_CLIENT_ID or TRADOVATE_CLIENT_SECRET.');
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state: state,
      scope: 'read:accounts read:orders read:fills'
    });
    // Note: Tradovate's OAuth URL might differ, using a standard pattern here.
    // Based on docs: /auth/oauthtoken is for exchange, but the redirect starts at their portal.
    return `https://trader.tradovate.com/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<TradovateTokenResponse> {
    if (!this.isConfigured()) {
      throw new Error('Tradovate OAuth is not configured.');
    }
    const response = await fetch(`${TRADOVATE_AUTH_URL}/oauthtoken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Tradovate token exchange failed: ${error}`);
    }

    return await response.json();
  }

  async renewToken(refreshToken: string): Promise<TradovateTokenResponse> {
    if (!this.isConfigured()) {
      throw new Error('Tradovate OAuth is not configured.');
    }
    const response = await fetch(`${TRADOVATE_AUTH_URL}/renewaccesstoken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Tradovate token renewal failed: ${error}`);
    }

    return await response.json();
  }

  async getMe(accessToken: string) {
    const response = await fetch(`${TRADOVATE_AUTH_URL}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error('Failed to fetch Tradovate user info');
    return await response.json();
  }

  async getAccounts(accessToken: string): Promise<any[]> {
    const response = await fetch(`${TRADOVATE_API_URL}/account/list`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error('Failed to fetch Tradovate accounts');
    return await response.json();
  }

  async getFills(accessToken: string, accountId: string, startTime?: string): Promise<any[]> {
    const params = new URLSearchParams({ accountId });
    if (startTime) params.append('startTime', startTime);

    const response = await fetch(`${TRADOVATE_API_URL}/fill/list?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error('Failed to fetch Tradovate fills');
    return await response.json();
  }

  // A fill only carries contractId (a raw numeric id, e.g. 2586692) — the
  // human-readable ticker (e.g. "MNQZ6") that contractSpecs.ts's
  // getRootSymbol/getPointValue need lives on the separate Contract
  // resource and has to be looked up. Getting this wrong doesn't error,
  // it silently mis-prices every live-synced trade (falls back to the
  // $1/point default instead of MNQ's real $2/point).
  async getContract(accessToken: string, contractId: number): Promise<{ id: number; name: string } | null> {
    const response = await fetch(`${TRADOVATE_API_URL}/contract/item?id=${contractId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return null;
    const contract = await response.json();
    return contract?.name ? { id: contract.id, name: contract.name } : null;
  }

  normalizeFill(fill: any, connectionId: string, accountId: string, symbol: string): Partial<IngestionEvent> {
    const externalEventId = `fill_${fill.id}`;
    const side = fill.side === 'Buy' ? 'BUY' : 'SELL';

    // Dedupe hash
    const hash = crypto.createHash('md5')
      .update(`${accountId}_${fill.id}_${fill.timestamp}_${fill.price}_${fill.qty}`)
      .digest('hex');

    return {
      connectionId,
      accountId,
      externalEventId,
      eventType: 'fill_received',
      orderId: fill.orderId?.toString(),
      fillId: fill.id?.toString(),
      symbol,
      side,
      quantity: fill.qty,
      avgFillPrice: fill.price,
      eventTimestamp: fill.timestamp,
      dedupeHash: hash,
      rawPayload: fill,
      normalizedPayload: {
        broker: 'tradovate',
        originalSide: fill.side,
        originalSymbol: fill.contractId
      },
      processingStatus: 'pending'
    };
  }
}
