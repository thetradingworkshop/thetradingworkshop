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

import { getFirestore } from "firebase-admin/firestore";

// Initialize Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId
  });
}

const db = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // --- Tradovate OAuth ---

  app.get("/api/auth/tradovate/url", async (req, res) => {
    if (!tradovate.isConfigured()) {
      return res.status(403).json({ 
        error: "Tradovate OAuth is disabled. Please use manual CSV upload.",
        isConfigured: false 
      });
    }
    const state = uuidv4();
    const url = tradovate.getAuthorizationUrl(state);
    res.json({ url });
  });

  app.get("/api/auth/tradovate/callback", async (req, res) => {
    if (!tradovate.isConfigured()) {
      return res.status(403).send("Tradovate OAuth is disabled.");
    }
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send("Missing authorization code");
    }

    try {
      const tokenData = await tradovate.exchangeCode(code as string);
      const userInfo = await tradovate.getMe(tokenData.access_token);
      const accountsData = await tradovate.getAccounts(tokenData.access_token);

      const userId = req.headers["x-user-id"] as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized: Missing user ID" });
      
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

  app.post("/api/connections/:connectionId/sync", async (req, res) => {
    const { connectionId } = req.params;
    try {
      await syncConnection(connectionId);
      res.json({ status: "sync_started" });
    } catch (error) {
      res.status(500).json({ error: "Sync failed" });
    }
  });

  app.post("/api/connections/manual/tradovate", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    
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

  app.post("/api/connections/:connectionId/upload", async (req, res) => {
    const { connectionId } = req.params;
    const { csvText } = req.body;
    const userId = req.headers["x-user-id"] as string;

    if (!csvText || !userId) {
      return res.status(400).json({ error: "Missing CSV text or user ID" });
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

  app.post("/api/mentor/enhance", async (req, res) => {
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

  app.post("/api/sessions/recalculate", async (req, res) => {
    const { userId, sessionDate } = req.body;
    if (!userId || !sessionDate) {
      return res.status(400).json({ error: "userId and sessionDate are required" });
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
                ...trade,
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

  // Background Jobs
  setInterval(async () => {
    try {
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
    } catch (error) {}
  }, 10 * 60 * 1000);

  setInterval(async () => {
    try {
      const snapshot = await db.collection("broker_connections")
        .where("status", "==", "connected")
        .where("authType", "==", "OAuth")
        .get();
      for (const doc of snapshot.docs) {
        await syncConnection(doc.id);
      }
    } catch (error) {}
  }, 15 * 60 * 1000);

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
