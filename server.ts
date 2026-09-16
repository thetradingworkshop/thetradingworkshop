import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import firebaseConfig from "./firebase-applet-config.json";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { TradovateService } from "./tradovate-service.js";
import { reconstructTrades } from "./src/engine.js";
import { IngestionEvent, Order, Trade, Session } from "./src/types.js";
import { computeSessionFromTrades, determineSessionWindow } from './src/analytics.js';
import { getRootSymbol } from './src/contractSpecs.js';

import { getFirestore } from "firebase-admin/firestore";

// Local dev/testing only — never touches production. Opt in with
// USE_FIREBASE_EMULATOR=true (set by `npm run dev:emulated`), which points
// the Admin SDK at the Firebase Local Emulator Suite's Firestore *and* Auth
// instances instead of the real project, so local testing never reads/
// writes real data. The Auth emulator host is required for
// admin.auth().verifyIdToken() (see requireAuth below) to accept tokens
// issued by the local Auth emulator — without it the Admin SDK verifies
// against real Google servers regardless of the Firestore setting, so every
// local request would fail auth even signed in correctly against the
// emulator.
if (process.env.USE_FIREBASE_EMULATOR === "true") {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  console.warn("[server] Connected to LOCAL FIRESTORE + AUTH EMULATORS — not production.");
}

// Initialize Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId
  });
}

const db = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");
// CSV-sourced fills never set `fillId` (only live Tradovate API fills do —
// see normalizeFill in tradovate-service.ts), so a reconstructed trade's
// `fills` array routinely contains an undefined fillId. The Admin SDK
// throws on writing that, so processEventsForConnectionInternal silently
// marked the event `processingStatus: "failed"` while the upload endpoint
// still reported `{status: "success"}` to the client — CSV imports appeared
// to work but produced zero trades. `ignoreUndefinedProperties` alone
// didn't cover this (nested array-element fields on this SDK version), so
// also strip undefined recursively at the actual write site below.
db.settings({ ignoreUndefinedProperties: true });

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const tradovate = new TradovateService();
// Reads ANTHROPIC_API_KEY from the environment. Kept server-side only — never
// sent to the client, unlike the old GEMINI_API_KEY which was baked into the
// browser bundle via vite.config.ts.
const anthropic = new Anthropic();

const MENTOR_INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    sessionSummary: { type: "string" },
    whatWorked: { type: "array", items: { type: "string" } },
    whatHurt: { type: "array", items: { type: "string" } },
    coreProblem: { type: "string" },
    executionVsStrategy: { type: "string" },
    actionPlan: { type: "array", items: { type: "string" } },
  },
  required: ["sessionSummary", "whatWorked", "whatHurt", "coreProblem", "executionVsStrategy", "actionPlan"],
  additionalProperties: false,
} as const;

// Day View Phase 4 ("Review with AI") — distinct from MENTOR_INSIGHT_SCHEMA
// above: that one polishes the wording of an already-computed deterministic
// insight; this one is a genuine free-form narrative generated straight from
// a single day's trades, its journal note, and strategy-rule adherence, with
// no deterministic structure underneath it to preserve.
const DAY_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    narrative: { type: "string" },
    wins: { type: "array", items: { type: "string" } },
    mistakes: { type: "array", items: { type: "string" } },
    themes: { type: "array", items: { type: "string" } },
  },
  required: ["narrative", "wins", "mistakes", "themes"],
  additionalProperties: false,
} as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Verifies the caller's real Firebase ID token (Authorization: Bearer
// <token>) and attaches the verified uid to req.uid. Every route below that
// touches or costs money against a specific user's data now requires this,
// instead of trusting a client-supplied `x-user-id` header or `userId` body
// field — those were never actually checked against who was signed in, so
// any request could act as any user (upload trade data into their account,
// trigger a session recalculation, generate an AI review on their behalf,
// run up the Anthropic bill). verifyIdToken() is the real check: it
// cryptographically validates the token against Firebase, the same way the
// client SDK's own requests are authenticated.
async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: missing bearer token" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice("Bearer ".length));
    (req as any).uid = decoded.uid;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
  }
}

async function isAdminUid(uid: string): Promise<boolean> {
  const doc = await db.collection("users").doc(uid).get();
  return doc.exists && (doc.data() as any).role === "Admin";
}

// Broker-connection-scoped routes (sync, upload) act on a connectionId the
// client supplies — requireAuth alone only proves *who* is asking, not that
// they're allowed to touch *this* connection. This is the second half of
// that check: the connection's own owner, or an Admin.
async function assertOwnsConnection(uid: string, connectionId: string): Promise<boolean> {
  const doc = await db.collection("broker_connections").doc(connectionId).get();
  if (!doc.exists) return false;
  if ((doc.data() as any).userId === uid) return true;
  return isAdminUid(uid);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // --- Tradovate OAuth ---

  app.get("/api/auth/tradovate/url", requireAuth, async (req, res) => {
    if (!tradovate.isConfigured()) {
      return res.status(403).json({
        error: "Tradovate OAuth is disabled. Please use manual CSV upload.",
        isConfigured: false
      });
    }
    const state = uuidv4();
    // Tradovate's redirect back to /api/auth/tradovate/callback is a plain
    // top-level browser navigation — it can't carry an Authorization header,
    // so the callback used to fall back on trusting a client-supplied
    // x-user-id header instead, with nothing tying it to who actually
    // started this flow. Binding the verified uid to this one-time state
    // value here (server-side, right after verifying the token above) lets
    // the callback recover the real user without needing a header at all.
    await db.collection("oauth_states").doc(state).set({
      userId: (req as any).uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const url = tradovate.getAuthorizationUrl(state);
    res.json({ url });
  });

  app.get("/api/auth/tradovate/callback", async (req, res) => {
    if (!tradovate.isConfigured()) {
      return res.status(403).send("Tradovate OAuth is disabled.");
    }
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send("Missing authorization code or state");
    }

    // Recover the real, verified user this flow was started for — see the
    // comment on /api/auth/tradovate/url above. One-time use (deleted right
    // away) and time-boxed, so a leaked/logged state value in a browser
    // history or proxy log is only ever useful for a few minutes.
    const stateRef = db.collection("oauth_states").doc(state as string);
    const stateDoc = await stateRef.get();
    if (!stateDoc.exists) {
      return res.status(400).send("Invalid or expired authorization state");
    }
    const { userId, createdAt } = stateDoc.data() as { userId: string; createdAt?: admin.firestore.Timestamp };
    await stateRef.delete();
    const stateAgeMs = createdAt ? Date.now() - createdAt.toMillis() : Infinity;
    if (stateAgeMs > 15 * 60 * 1000) {
      return res.status(400).send("Authorization state expired — please reconnect.");
    }

    try {
      const tokenData = await tradovate.exchangeCode(code as string);
      const userInfo = await tradovate.getMe(tokenData.access_token);
      const accountsData = await tradovate.getAccounts(tokenData.access_token);

      const connectionId = uuidv4();
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

      const connection = {
        id: connectionId,
        userId,
        brokerName: "tradovate",
        authType: "OAuth",
        status: "connected",
        environment: "live",
        externalUserId: userInfo.userId?.toString(),
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await db.collection("broker_connections").doc(connectionId).set(connection);

      const batch = db.batch();
      for (const acc of accountsData) {
        const accountId = uuidv4();
        const account = {
          id: accountId,
          connectionId,
          externalAccountId: acc.id.toString(),
          displayName: acc.name,
          status: "active",
          selectedForSync: false
        };
        batch.set(db.collection("broker_connections").doc(connectionId).collection("accounts").doc(accountId), account);
      }
      await batch.commit();

      res.redirect(`/connections?new_connection=${connectionId}`);

    } catch (error) {
      console.error("Tradovate Callback Error:", error);
      res.redirect("/connections?error=auth_failed");
    }
  });

  app.post("/api/connections/:connectionId/sync", requireAuth, async (req, res) => {
    const { connectionId } = req.params;
    if (!(await assertOwnsConnection((req as any).uid, connectionId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      await syncConnection(connectionId);
      res.json({ status: "sync_started" });
    } catch (error) {
      res.status(500).json({ error: "Sync failed" });
    }
  });

  app.post("/api/connections/manual/tradovate", requireAuth, async (req, res) => {
    const userId = (req as any).uid;

    const connectionId = uuidv4();
    const connection = {
      id: connectionId,
      userId,
      brokerName: "tradovate",
      authType: "Manual",
      syncMode: "manual_csv",
      status: "manual_sync_active",
      environment: "live",
      importCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await db.collection("broker_connections").doc(connectionId).set(connection);
      res.json({ connectionId });
    } catch (error) {
      console.error("Failed to create manual connection:", error);
      res.status(500).json({ error: "Failed to create manual connection" });
    }
  });

  app.post("/api/connections/:connectionId/upload", requireAuth, async (req, res) => {
    const { connectionId } = req.params;
    const { csvText } = req.body;
    const userId = (req as any).uid;

    if (!csvText) {
      return res.status(400).json({ error: "Missing CSV text" });
    }
    if (!(await assertOwnsConnection(userId, connectionId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    try {
      const connDoc = await db.collection("broker_connections").doc(connectionId).get();
      if (!connDoc.exists) return res.status(404).json({ error: "Connection not found" });

      const { parseTradovateCsv } = await import("./src/engine.js");
      const result = parseTradovateCsv(csvText, userId);

      const runId = await createImportRun(connectionId, 'csv', ["manual-account"]);
      
      const batch = db.batch();
      const accountId = "manual-account";
      let addedEventCount = 0;

      for (const order of result.orders) {
        const dedupeHash = crypto.createHash('md5')
          .update(`${accountId}-${order.brokerOrderId}-${order.timestamp}-${order.price}-${order.quantity}`)
          .digest('hex');

        const eventRef = db.collection("ingestion_events").doc(dedupeHash);
        const existingEvent = await eventRef.get();

        if (!existingEvent.exists) {
          batch.set(eventRef, {
            id: dedupeHash,
            userId,
            connectionId,
            accountId,
            type: 'csv_upload',
            status: 'completed',
            processingStatus: "pending",
            timestamp: new Date().toISOString(),
            eventTimestamp: order.timestamp,
            symbol: order.symbol,
            side: order.side,
            quantity: order.quantity,
            avgFillPrice: order.price,
            orderId: order.brokerOrderId,
            importRunId: runId,
            payload: order,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
          addedEventCount++;
        }
      }

      if (addedEventCount > 0) {
        await batch.commit();
      }

      await processEventsForConnectionInternal(connectionId, runId);
      await completeImportRun(runId, 'success');

      res.json({ 
        status: "success", 
        importedCount: result.orders.length,
        importRunId: runId
      });

    } catch (error) {
      console.error("Upload processing error:", error);
      res.status(500).json({ error: "Failed to process upload" });
    }
  });

  // --- AI Mentor ---

  // No specific resource ownership to check here (it just rewrites whatever
  // insight/trades the client sends, doesn't read or write anyone's stored
  // data by id) — but it's a real Anthropic API call and therefore a real
  // cost, so still gated to signed-in users rather than left open to
  // anonymous cost-abuse.
  app.post("/api/mentor/enhance", requireAuth, async (req, res) => {
    const { insight, trades, stats } = req.body as {
      insight: {
        sessionSummary: string;
        whatWorked: string[];
        whatHurt: string[];
        coreProblem: string;
        executionVsStrategy: string;
        actionPlan: string[];
      };
      trades: Trade[];
      stats: { winRate: number; profitFactor: number; avgWinner: number; avgLoser: number } | null;
    };

    if (!insight || !Array.isArray(trades)) {
      return res.status(400).json({ error: "insight and trades are required" });
    }

    const tradeSummary = trades.slice(0, 10).map(t =>
      `- ${t.symbol} ${t.direction}: ${t.isWinner ? 'WIN' : 'LOSS'} ($${(t.pnlPoints ?? 0).toFixed(0)}), Grade: ${t.tradeGrade}, Hold: ${Math.round((t.holdTimeSeconds ?? 0) / 60)}m`
    ).join('\n');

    const prompt = `
      You are an expert trading performance coach. I will provide you with a structured trading insight and the underlying trade data.
      Your goal is to enhance the natural language parts of this insight while maintaining the core data and structure.

      UNDERLYING DATA:
      - Total Trades: ${trades.length}
      - Win Rate: ${stats?.winRate?.toFixed(1)}%
      - Profit Factor: ${stats?.profitFactor?.toFixed(2)}
      - Avg Winner: $${stats?.avgWinner?.toFixed(0)}
      - Avg Loser: $${stats?.avgLoser?.toFixed(0)}
      - Sample Trades:
      ${tradeSummary}

      STRUCTURED INSIGHT (DETERMINISTIC):
      - Session Summary: ${insight.sessionSummary}
      - What Worked: ${insight.whatWorked.join(", ")}
      - What Hurt: ${insight.whatHurt.join(", ")}
      - Core Problem: ${insight.coreProblem}
      - Execution vs Strategy: ${insight.executionVsStrategy}
      - Action Plan: ${insight.actionPlan.join(", ")}

      INSTRUCTIONS:
      1. Be precise and data-driven.
      2. Use measurable cause-effect statements (e.g., "Re-entries reduced expectancy by 0.6R").
      3. Ensure the Core Problem is singular and specific.
      4. Action Plan must be max 3 bullets and directly map to detected issues.
      5. Maintain the exact structure.
    `;

    try {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 2048,
        output_config: { format: { type: "json_schema", schema: MENTOR_INSIGHT_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (!textBlock) throw new Error("No text response from Claude");
      const enhanced = JSON.parse(textBlock.text);

      res.json({
        ...insight,
        ...enhanced,
        actionPlan: (enhanced.actionPlan || insight.actionPlan).slice(0, 3),
      });
    } catch (error: any) {
      const isRateLimited = error?.status === 429;
      if (isRateLimited) {
        console.warn("Claude API rate limited.");
        return res.status(429).json(insight);
      }
      console.error("Mentor enhancement failed:", error);
      res.json(insight);
    }
  });

  // Day View Phase 4 — "Review with AI". Cached in `session_reviews`
  // (Admin-SDK-only writes, see firestore.rules) keyed by `${userId}_${sessionDate}`
  // so opening the same day's review twice doesn't re-call the model; pass
  // forceRegenerate to bypass the cache and overwrite it.
  app.post("/api/day-review/generate", requireAuth, async (req, res) => {
    const { sessionDate, dayLabel, trades, journalNote, strategyNotes, forceRegenerate } = req.body as {
      sessionDate: string;
      dayLabel: string;
      trades: { symbol: string; direction: string; isWinner: boolean; pnlCurrency: number; entryTime: string; exitTime: string }[];
      journalNote?: string;
      strategyNotes?: string[];
      forceRegenerate?: boolean;
    };
    // Always the verified caller, never a client-supplied value — this
    // writes into session_reviews/{userId}_{sessionDate}, so trusting a
    // client-sent userId here used to let anyone overwrite (or read, via
    // the cache-hit path) anyone else's cached review.
    const userId = (req as any).uid;

    if (!sessionDate || !Array.isArray(trades) || trades.length === 0) {
      return res.status(400).json({ error: "sessionDate and a non-empty trades array are required" });
    }

    const reviewId = `${userId}_${sessionDate}`;
    const reviewRef = db.collection("session_reviews").doc(reviewId);

    if (!forceRegenerate) {
      const existing = await reviewRef.get();
      if (existing.exists) {
        return res.json({ ...existing.data(), cached: true });
      }
    }

    const tradeLines = trades.map(t =>
      `- ${t.symbol} ${t.direction}: ${t.isWinner ? 'WIN' : 'LOSS'} ($${t.pnlCurrency.toFixed(2)}), entered ${new Date(t.entryTime).toLocaleTimeString('en-US')}, exited ${new Date(t.exitTime).toLocaleTimeString('en-US')}`
    ).join('\n');

    const prompt = `
      You are an expert trading performance coach reviewing one trader's single trading day.
      Write a short narrative review of this specific day, then break it into three parts.

      DAY: ${dayLabel}

      TRADES (chronological):
      ${tradeLines}

      ${journalNote ? `THE TRADER'S OWN JOURNAL NOTE FOR THIS DAY:\n${journalNote}\n` : ''}
      ${strategyNotes && strategyNotes.length > 0 ? `STRATEGY RULE ADHERENCE:\n${strategyNotes.join('\n')}\n` : ''}

      INSTRUCTIONS:
      1. "narrative" is 2-4 sentences, written directly to the trader ("you"), grounded in the actual trades and figures above — no generic platitudes.
      2. "wins" lists what genuinely went well today (specific, not generic) — an empty array is fine if nothing did.
      3. "mistakes" lists specific errors or rule breaks visible in the data above — an empty array is fine if none are evident.
      4. "themes" lists 1-3 short recurring patterns worth watching across future sessions, inferred only from what's actually present today.
      5. Never fabricate details not present in the trades, journal note, or strategy notes above.
    `;

    try {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1024,
        output_config: { format: { type: "json_schema", schema: DAY_REVIEW_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (!textBlock) throw new Error("No text response from Claude");
      const generated = JSON.parse(textBlock.text);

      const review = {
        userId,
        sessionDate,
        narrative: generated.narrative,
        wins: generated.wins ?? [],
        mistakes: generated.mistakes ?? [],
        themes: generated.themes ?? [],
        generatedAt: new Date().toISOString(),
        model: "claude-opus-4-8",
      };
      await reviewRef.set(review);

      res.json({ ...review, cached: false });
    } catch (error: any) {
      const isRateLimited = error?.status === 429;
      if (isRateLimited) {
        console.warn("Claude API rate limited (day review).");
        return res.status(429).json({ error: "Rate limited, try again shortly." });
      }
      console.error("Day review generation failed:", error);
      res.status(500).json({ error: "Failed to generate day review" });
    }
  });

  // Proxies Yahoo Finance's public (unauthenticated) chart endpoint for the
  // futures root matching a trade's symbol, e.g. "MNQU6" -> "MNQ" -> "MNQ=F".
  // Proxying server-side avoids the browser CORS restriction on Yahoo's API
  // and keeps the User-Agent handling in one place. Data is real but delayed
  // (Yahoo's free feed, not a paid real-time subscription) — fine for
  // after-the-fact trade study, not for live trading decisions.
  // How far back to fetch when the client explicitly requests a timeframe
  // (rather than the default auto-selected narrow trade window) — enough
  // bars for a top-down look at market structure leading into the trade,
  // within what Yahoo's chart API actually serves per interval.
  // Each entry maps a client-facing timeframe id to how far back to look and
  // which Yahoo interval to request. Most entries request that same
  // interval directly from Yahoo; `aggregateHours` marks the two (4h/8h)
  // that Yahoo has no native interval for at all — those fetch real hourly
  // bars and get bucketed client-side (well, server-side, but before it
  // reaches the client) by aggregateBars() below into 4/8-hour candles,
  // same underlying trade data a real 4h/8h feed would be built from, just
  // resampled here instead of upstream.
  const TIMEFRAME_CONFIG: Record<string, { lookbackSeconds: number; interval: string; aggregateHours?: number }> = {
    "1m": { lookbackSeconds: 5 * 24 * 3600, interval: "1m" },
    "5m": { lookbackSeconds: 30 * 24 * 3600, interval: "5m" },
    "15m": { lookbackSeconds: 45 * 24 * 3600, interval: "15m" },
    "30m": { lookbackSeconds: 60 * 24 * 3600, interval: "30m" },
    "1h": { lookbackSeconds: 180 * 24 * 3600, interval: "1h" },
    // 729 days, not some rounder/bigger number — verified directly against
    // Yahoo: it serves 60m-interval data up to exactly 730 days back and
    // hard-rejects (422) anything past that, regardless of how coarse the
    // *displayed* candle ends up being after aggregateBars() buckets it
    // down to 4h/8h — the raw fetch underneath is still 60m either way.
    "4h": { lookbackSeconds: 729 * 24 * 3600, interval: "1h", aggregateHours: 4 },
    "8h": { lookbackSeconds: 729 * 24 * 3600, interval: "1h", aggregateHours: 8 },
    // "24 hours" and "1 day" end up as the exact same request — Yahoo has no
    // rolling 24h interval distinct from its own calendar-day bars — kept as
    // two config entries anyway so each timeframe-menu option still reports
    // back the id the user actually picked (see `interval` in the response
    // below), not a possibly-confusing "1d" label under an "24 hours" button.
    "24h": { lookbackSeconds: 1460 * 24 * 3600, interval: "1d" },
    "1d": { lookbackSeconds: 1460 * 24 * 3600, interval: "1d" },
    "1w": { lookbackSeconds: 5 * 365 * 24 * 3600, interval: "1wk" },
    "1mo": { lookbackSeconds: 15 * 365 * 24 * 3600, interval: "1mo" },
  };

  // Buckets consecutive same-interval bars into `hours`-wide candles aligned
  // to UTC boundaries divisible by `hours` (e.g. 4h buckets start at
  // 00:00/04:00/08:00... UTC) — see the 4h/8h TIMEFRAME_CONFIG comment above.
  function aggregateBars(bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[], hours: number) {
    const bucketSec = hours * 3600;
    const buckets = new Map<number, typeof bars>();
    for (const b of bars) {
      const bucketStart = Math.floor(b.time / bucketSec) * bucketSec;
      const group = buckets.get(bucketStart);
      if (group) group.push(b); else buckets.set(bucketStart, [b]);
    }
    return Array.from(buckets.entries())
      .sort(([a], [z]) => a - z)
      .map(([time, group]) => ({
        time,
        open: group[0].open,
        high: Math.max(...group.map(g => g.high)),
        low: Math.min(...group.map(g => g.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((sum, g) => sum + g.volume, 0),
      }));
  }

  app.get("/api/market/candles", async (req, res) => {
    const { symbol, start, end, interval: requestedInterval } = req.query as { symbol?: string; start?: string; end?: string; interval?: string };
    if (!symbol || !start || !end) {
      return res.status(400).json({ error: "symbol, start, and end are required" });
    }

    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    // endMs === startMs is a valid, real case — an instant scratch trade
    // (entry and exit fills at the same timestamp). Only reject end strictly
    // before start, a genuine data error.
    if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
      return res.status(400).json({ error: "Invalid start/end" });
    }

    const root = getRootSymbol(symbol);
    const yahooSymbol = `${root}=F`;

    let interval: string;
    let period1: number;
    let period2: number;

    const timeframeConfig = requestedInterval ? TIMEFRAME_CONFIG[requestedInterval] : undefined;
    if (timeframeConfig) {
      interval = timeframeConfig.interval;
      const padSec = 30 * 60;
      // These presets are for top-down context around the trade, not just a
      // window ending at it — capping period2 at the trade's own exit+pad
      // cut the chart off shortly after entry/exit even though the market
      // kept trading for hours afterward. Extend through "now" (real trading
      // continues past the trade until this request is made), falling back
      // to exit+pad only for the unusual case of a trade whose exit is
      // itself still in the future relative to this request.
      period2 = Math.ceil(Math.max(endMs / 1000 + padSec, Date.now() / 1000));
      // The lookback above is sized for *context* around a recent trade —
      // but a trade older than that lookback would put period1 after the
      // trade's own start, silently fetching a window of unrelated recent
      // candles instead: no entry/exit markers, no drawings, nothing tying
      // the chart to the trade at all, and no error to explain why (this is
      // exactly what made a saved long/short position "disappear" on a
      // timeframe switch — the fetch window had quietly moved out from
      // under it). Extend back through the trade's own start whenever it's
      // older than the preset's normal lookback would reach.
      period1 = Math.min(period2 - timeframeConfig.lookbackSeconds, Math.floor(startMs / 1000 - padSec));
    } else {
      const durationSec = (endMs - startMs) / 1000;
      const padSec = Math.min(30 * 60, Math.max(5 * 60, durationSec * 0.25));
      period1 = Math.floor(startMs / 1000 - padSec);
      period2 = Math.ceil(endMs / 1000 + padSec);
      const spanSec = period2 - period1;
      const daysAgo = (Date.now() / 1000 - period1) / 86400;

      interval = "1d";
      if (daysAgo <= 30) {
        interval = spanSec <= 2 * 3600 ? "1m" : spanSec <= 24 * 3600 ? "5m" : "15m";
      } else if (daysAgo <= 60) {
        interval = spanSec <= 5 * 24 * 3600 ? "15m" : "1h";
      }
    }

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&period1=${period1}&period2=${period2}`;
      const upstream = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!upstream.ok) {
        return res.status(502).json({ error: `Market data provider returned ${upstream.status}` });
      }
      const data: any = await upstream.json();
      const result = data?.chart?.result?.[0];
      if (!result?.timestamp?.length) {
        return res.status(404).json({ error: `No market data for ${yahooSymbol} in this window` });
      }

      const quote = result.indicators.quote[0];
      const bars = result.timestamp
        .map((t: number, i: number) => ({
          time: t,
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          close: quote.close[i],
          volume: quote.volume[i] ?? 0,
        }))
        .filter((b: any) => b.open != null && b.high != null && b.low != null && b.close != null);

      if (bars.length === 0) {
        return res.status(404).json({ error: `No usable market data for ${yahooSymbol} in this window` });
      }

      const outBars = timeframeConfig?.aggregateHours ? aggregateBars(bars, timeframeConfig.aggregateHours) : bars;
      if (outBars.length === 0) {
        return res.status(404).json({ error: `No usable market data for ${yahooSymbol} in this window` });
      }
      // Report back the id the user actually picked (e.g. "4h", "24h") when
      // one was requested, not the raw Yahoo interval it was built from
      // ("1h", "1d") — that's what the chart's own "(__ bars, delayed via
      // Yahoo Finance)" label reads directly, and "1h bars" under a 4h
      // button the user clicked would just be confusing.
      const outInterval = timeframeConfig ? requestedInterval! : interval;
      res.json({ symbol: root, yahooSymbol, interval: outInterval, delayed: true, bars: outBars });
    } catch (error) {
      console.error("Market data fetch failed:", error);
      res.status(502).json({ error: "Failed to fetch market data" });
    }
  });

  app.post("/api/sessions/recalculate", requireAuth, async (req, res) => {
    const { sessionDate } = req.body;
    const userId = (req as any).uid;
    if (!sessionDate) {
      return res.status(400).json({ error: "sessionDate is required" });
    }

    try {
      await updateSessionAnalytics(userId, sessionDate);
      res.json({ status: "success", message: `Recalculated session for ${sessionDate}` });
    } catch (error) {
      console.error("Manual session recalculation failed:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // --- Sync Engine ---

  async function acquireSyncLock(connectionId: string, timeoutMinutes = 10): Promise<boolean> {
    const connRef = db.collection("broker_connections").doc(connectionId);
    try {
      return await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(connRef);
        if (!doc.exists) return false;
        const data = doc.data() as any;
        const now = new Date();
        if (data.syncStatus === 'syncing' && data.syncLockExpiresAt) {
          if (now < new Date(data.syncLockExpiresAt)) return false;
        }
        const lockExpiresAt = new Date(now.getTime() + timeoutMinutes * 60 * 1000);
        transaction.update(connRef, {
          syncStatus: 'syncing',
          syncStartedAt: now.toISOString(),
          syncLockExpiresAt: lockExpiresAt.toISOString(),
          updatedAt: now.toISOString()
        });
        return true;
      });
    } catch (error) {
      return false;
    }
  }

  async function releaseSyncLock(connectionId: string, success: boolean, error?: string) {
    const connRef = db.collection("broker_connections").doc(connectionId);
    const now = new Date().toISOString();
    const updateData: any = {
      syncStatus: success ? 'idle' : 'failed',
      updatedAt: now
    };
    if (success) {
      updateData.lastSuccessfulSyncAt = now;
    } else {
      updateData.lastFailedSyncAt = now;
      updateData.lastSyncError = error || 'Unknown error';
    }
    try { await connRef.update(updateData); } catch (err) {}
  }

  async function createImportRun(connectionId: string, sourceType: 'csv' | 'api', accountIds: string[]) {
    const runId = uuidv4();
    const run = {
      id: runId,
      connectionId,
      accountIds,
      sourceType,
      startedAt: new Date().toISOString(),
      status: 'running',
      eventsCreated: 0,
      tradesClosed: 0
    };
    await db.collection("import_runs").doc(runId).set(run);
    return runId;
  }

  async function completeImportRun(runId: string, status: 'success' | 'failed') {
    await db.collection("import_runs").doc(runId).update({
      status,
      finishedAt: new Date().toISOString()
    });
  }

  async function syncConnection(connectionId: string) {
    const hasLock = await acquireSyncLock(connectionId);
    if (!hasLock) return;

    let success = false;
    let errorMessage = '';

    try {
      const connDoc = await db.collection("broker_connections").doc(connectionId).get();
      const conn = connDoc.data() as any;
      if (conn.status === "paused" || !conn.accessToken || !tradovate.isConfigured()) {
        await releaseSyncLock(connectionId, true);
        return;
      }

      const accountsSnapshot = await connDoc.ref.collection("accounts")
        .where("selectedForSync", "==", true)
        .get();

      const accountIds = accountsSnapshot.docs.map(d => d.id);
      const runId = await createImportRun(connectionId, 'api', accountIds);
      let totalEventsCreated = 0;

      for (const accDoc of accountsSnapshot.docs) {
        const account = accDoc.data() as any;
        const checkpointSnapshot = await db.collection("sync_checkpoints")
          .where("connectionId", "==", connectionId)
          .where("accountId", "==", account.id)
          .limit(1)
          .get();
        
        let startTime: string | undefined;
        if (!checkpointSnapshot.empty) startTime = checkpointSnapshot.docs[0].data().checkpointValue;

        const fills = await tradovate.getFills(conn.accessToken, account.externalAccountId, startTime);
        const batch = db.batch();
        
        for (const fill of fills) {
          const normalized = tradovate.normalizeFill(fill, connectionId, account.id);
          const eventRef = db.collection("ingestion_events").doc(normalized.dedupeHash);
          const existing = await eventRef.get();
          
          if (!existing.exists) {
            batch.set(eventRef, {
              ...normalized,
              id: normalized.dedupeHash,
              userId: conn.userId,
              type: 'tradovate_sync',
              status: 'completed',
              processingStatus: "pending",
              importRunId: runId,
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            totalEventsCreated++;
          }
        }
        if (totalEventsCreated > 0) await batch.commit();

        if (fills.length > 0) {
          const latestFill = fills.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
          const checkpointData = {
            connectionId,
            accountId: account.id,
            checkpointValue: latestFill.timestamp,
            updatedAt: new Date().toISOString()
          };
          if (checkpointSnapshot.empty) await db.collection("sync_checkpoints").add(checkpointData);
          else await checkpointSnapshot.docs[0].ref.update(checkpointData);
        }
      }

      await processEventsForConnectionInternal(connectionId, runId);
      await completeImportRun(runId, 'success');
      success = true;
    } catch (error) {
      console.error(`Sync failed for connection ${connectionId}:`, error);
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      await releaseSyncLock(connectionId, success, errorMessage);
    }
  }

  async function updateSessionAnalytics(userId: string, sessionDate: string) {
    try {
      const tradesSnapshot = await db.collection("trades")
        .where("userId", "==", userId)
        .where("sessionDate", "==", sessionDate)
        .get();
      
      const trades: Trade[] = tradesSnapshot.docs.map(doc => doc.data() as Trade);
      if (trades.length === 0) return;

      // Fetch intents for the session date
      const startOfDay = new Date(sessionDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(sessionDate);
      endOfDay.setHours(23, 59, 59, 999);

      const intentsSnapshot = await db.collection("trade_intents")
        .where("userId", "==", userId)
        .where("confirmedAt", ">=", startOfDay.toISOString())
        .where("confirmedAt", "<=", endOfDay.toISOString())
        .get();
      
      const intents = intentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];

      const sessionMetrics = computeSessionFromTrades(trades, intents);
      
      // Update trades with intent data if matched
      const tradeBatch = db.batch();
      let tradesToUpdate = 0;

      trades.forEach(trade => {
        const matchingIntent = intents.find(intent => 
          intent.symbol === trade.symbol && 
          Math.abs(new Date(intent.confirmedAt).getTime() - new Date(trade.entryTime).getTime()) < 300000 // 5 mins
        );

        const wasValidAtEntry = matchingIntent ? matchingIntent.isValidSetup : (trade.modelValidation?.followsModel !== false);
        const wasForced = matchingIntent ? matchingIntent.overrideUsed : false;
        const isViolation = !wasValidAtEntry || wasForced;

        const tradeRef = db.collection("trades").doc(trade.id);
        tradeBatch.update(tradeRef, {
          intentId: matchingIntent ? matchingIntent.id : null,
          wasValidAtEntry,
          wasForced,
          isViolation,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        tradesToUpdate++;
      });

      if (tradesToUpdate > 0) {
        await tradeBatch.commit();
      }

      const firstTradeEntryTime = [...trades].sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime())[0].entryTime;
      const sessionWindow = determineSessionWindow(firstTradeEntryTime);

      const sessionId = `${userId}_${sessionDate}`;
      const sessionRef = db.collection("sessions").doc(sessionId);
      
      await sessionRef.set({
        ...sessionMetrics,
        id: sessionId,
        userId,
        startTime: firstTradeEntryTime,
        endTime: [...trades].sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime())[0].exitTime,
        status: 'closed',
        updatedAt: new Date().toISOString()
      }, { merge: true });

    } catch (error) {
      console.error(`Error updating session analytics:`, error);
    }
  }

  async function processEventsForConnectionInternal(connectionId: string, importRunId?: string) {
    const eventsSnapshot = await db.collection("ingestion_events")
      .where("connectionId", "==", connectionId)
      .where("processingStatus", "==", "pending")
      .orderBy("eventTimestamp", "asc")
      .get();

    if (eventsSnapshot.empty) return;

    const runId = importRunId || uuidv4();
    const connDoc = await db.collection("broker_connections").doc(connectionId).get();
    const conn = connDoc.data() as any;
    const { processEventStatefully } = await import("./src/engine.js");
    const affectedSessionDates = new Set<string>();

    // Mark as processing
    const markBatch = db.batch();
    eventsSnapshot.docs.forEach(doc => {
      markBatch.update(doc.ref, { 
        processingStatus: 'processing',
        processingRunId: runId
      });
    });
    await markBatch.commit();

    const eventsByAccountAndSymbol: Record<string, any[]> = {};
    eventsSnapshot.docs.forEach(doc => {
      const event = doc.data();
      const key = `${event.accountId}_${event.symbol}`;
      if (!eventsByAccountAndSymbol[key]) eventsByAccountAndSymbol[key] = [];
      eventsByAccountAndSymbol[key].push(event);
    });

    for (const [key, accSymEvents] of Object.entries(eventsByAccountAndSymbol)) {
      const [accountId, symbol] = key.split('_');
      const stateId = `${connectionId}_${accountId}_${symbol}`;
      const stateRef = db.collection("position_state").doc(stateId);
      const stateDoc = await stateRef.get();
      
      let state = stateDoc.exists ? stateDoc.data() : {
        id: stateId,
        connectionId,
        accountId,
        symbol,
        currentPosition: 0,
        avgEntryPrice: 0,
        openTradeId: null,
        openTradeDirection: null,
        totalEntryQuantity: 0,
        totalExitQuantity: 0,
        entryValue: 0,
        exitValue: 0,
        entryTime: null,
        lastProcessedEventTimestamp: '',
        lastProcessedEventId: '',
        rawOrderIds: [],
        fills: [],
        updatedAt: new Date().toISOString()
      };

      for (const event of accSymEvents) {
        try {
          const result = processEventStatefully(state as any, event as any);
          state = result.updatedState;

          if (result.closedTrades.length > 0) {
            const tradeBatch = db.batch();
            for (const trade of result.closedTrades) {
              const tradeRef = db.collection("trades").doc(trade.id);
              tradeBatch.set(tradeRef, {
                ...stripUndefined(trade),
                userId: conn.userId,
                connectionId,
                accountId,
                sessionDate: trade.entryTime.split('T')[0],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              affectedSessionDates.add(trade.entryTime.split('T')[0]);
            }
            await tradeBatch.commit();
          }

          await db.collection("ingestion_events").doc(event.id).update({
            processingStatus: "processed",
            processedAt: new Date().toISOString(),
            processingRunId: runId
          });

        } catch (error) {
          console.error(`Error processing event ${event.id}:`, error);
          await db.collection("ingestion_events").doc(event.id).update({
            processingStatus: "failed",
            processingError: error instanceof Error ? error.message : String(error),
            processingRunId: runId
          });
        }
      }
      await stateRef.set(state);
    }

    for (const sessionDate of affectedSessionDates) {
      await updateSessionAnalytics(conn.userId, sessionDate);
    }
  }

  // Background Jobs — triggered by Cloud Scheduler HTTP calls rather than
  // setInterval, since the service runs at min-instances=0 (scale-to-zero)
  // and a background timer wouldn't survive the instance being torn down
  // between requests.
  async function refreshExpiringTokens() {
    const soon = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const snapshot = await db.collection("broker_connections")
      .where("brokerName", "==", "tradovate")
      .where("tokenExpiresAt", "<=", soon)
      .get();

    for (const doc of snapshot.docs) {
      const conn = doc.data() as any;
      if (!conn.refreshToken || !tradovate.isConfigured()) continue;
      const tokenData = await tradovate.renewToken(conn.refreshToken);
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);
      await doc.ref.update({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || conn.refreshToken,
        tokenExpiresAt: expiresAt.toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  async function syncAllConnectedAccounts() {
    const snapshot = await db.collection("broker_connections")
      .where("status", "==", "connected")
      .where("authType", "==", "OAuth")
      .get();
    for (const doc of snapshot.docs) {
      await syncConnection(doc.id);
    }
  }

  function requireCronSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!process.env.CRON_SECRET || req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  }

  app.post("/api/cron/refresh-tokens", requireCronSecret, async (req, res) => {
    try {
      await refreshExpiringTokens();
      res.json({ status: "ok" });
    } catch (error) {
      console.error("Token refresh cron failed:", error);
      res.status(500).json({ error: "Token refresh failed" });
    }
  });

  app.post("/api/cron/sync-connections", requireCronSecret, async (req, res) => {
    try {
      await syncAllConnectedAccounts();
      res.json({ status: "ok" });
    } catch (error) {
      console.error("Sync cron failed:", error);
      res.status(500).json({ error: "Sync failed" });
    }
  });

  // Also run these on an in-process timer for hosts that keep a persistent
  // server running (e.g. Render) rather than scaling to zero between
  // requests — the /api/cron/* endpoints above are for hosts like Cloud Run
  // where an external scheduler has to trigger them instead.
  if (process.env.DISABLE_INTERVAL_JOBS !== "true") {
    setInterval(() => { refreshExpiringTokens().catch(() => {}); }, 10 * 60 * 1000);
    setInterval(() => { syncAllConnectedAccounts().catch(() => {}); }, 15 * 60 * 1000);
  }

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => res.sendFile(path.resolve("dist", "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
