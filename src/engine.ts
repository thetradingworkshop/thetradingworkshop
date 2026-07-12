import { v4 as uuidv4 } from 'uuid';
import Papa from 'papaparse';
import { IngestionEvent, Order, Trade, TradeTruth, TradeDerivedMetrics, TradeReview, ReconstructionStep, ParseResult, PositionState, TradeDiagnostics } from './types.js';
import { getPointValue, getCommissionPerContract } from './contractSpecs.js';

export type { ParseResult };

/**
 * Parses a Tradovate CSV export into standardized Order objects.
 */
export function parseTradovateCsv(csvText: string, userId: string = 'manual-user'): ParseResult {
  const result: ParseResult = { 
    orders: [], 
    errors: [], 
    ignored: [],
    summary: { 
      brokerFormat: 'Tradovate',
      totalRows: 0, 
      parsedRows: 0,
      validFilledRows: 0,
      ignoredRows: 0, 
      symbols: [],
      sideHeaderUsed: undefined,
      allHeaders: [],
      sideCandidateFields: ['side', 'action', 'direction', 'buysell', 'buy/sell', 'transaction type', 'trade action', 'bs', 'b/s']
    },
    ignoredRowsDetails: []
  };
  
  try {
    // 1. Normalize headers before parsing
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) {
      result.errors.push("The CSV file is empty.");
      return result;
    }

    const headerLine = lines[0];
    const rawHeaders = headerLine.split(',').map(h => h.trim());
    result.summary.allHeaders = rawHeaders;
    
    // Create a mapping of normalized header to original header
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const headerMap: Record<string, string> = {};
    rawHeaders.forEach(h => {
      headerMap[normalize(h)] = h;
    });

    const findHeader = (variants: string[]) => {
      for (const v of variants) {
        const normV = normalize(v);
        if (headerMap[normV]) return headerMap[normV];
      }
      return null;
    };

    const colMap = {
      timestamp: findHeader(['timestamp', 'time', 'filltime', 'datetime', 'date', 'fill time', 'order time']),
      symbol: findHeader(['symbol', 'contract', 'product', 'instrument', 'item']),
      side: findHeader(result.summary.sideCandidateFields!),
      quantity: findHeader(['quantity', 'qty', 'filledqty', 'filledquantity', 'size', 'filled qty']),
      price: findHeader(['price', 'fillprice', 'avgprice', 'averagefillprice', 'executionprice', 'fill price', 'avg price']),
      orderId: findHeader(['orderid', 'order id', 'id', 'brokerorderid', 'fillid', 'executionid', 'order #']),
      status: findHeader(['status', 'orderstatus', 'state', 'order status'])
    };

    result.summary.sideHeaderUsed = colMap.side || 'None Found';

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      transformHeader: (header) => normalize(header)
    });

    if (parsed.errors.length > 0) {
      result.errors.push(`CSV Parsing Error: ${parsed.errors[0].message}`);
      return result;
    }

    const data = parsed.data as any[];
    result.summary.totalRows = data.length;
    const symbolsSet = new Set<string>();
    
    // Normalized keys for internal use
    const k = {
      timestamp: normalize(colMap.timestamp || 'timestamp'),
      symbol: normalize(colMap.symbol || 'symbol'),
      side: normalize(colMap.side || 'side'),
      quantity: normalize(colMap.quantity || 'quantity'),
      price: normalize(colMap.price || 'price'),
      orderId: normalize(colMap.orderId || 'orderid'),
      status: normalize(colMap.status || 'status')
    };

    const detectSide = (val: any): 'BUY' | 'SELL' | null => {
      if (!val) return null;
      const s = val.toString().toUpperCase().trim();
      if (s === 'BUY' || s === 'B' || s === 'LONG' || s === 'BOT' || s.startsWith('BUY')) return 'BUY';
      if (s === 'SELL' || s === 'S' || s === 'SHORT' || s === 'SLD' || s.startsWith('SELL')) return 'SELL';
      return null;
    };

    data.forEach((row, index) => {
      const rowNum = index + 2; // +1 for 0-index, +1 for header row
      
      const rawTimestamp = row[k.timestamp];
      const rawSymbol = row[k.symbol];
      const rawSide = row[k.side];
      const rawQuantity = row[k.quantity];
      const rawPrice = row[k.price];
      const rawOrderId = row[k.orderId];
      const rawStatus = row[k.status];

      // 1. Check for "Filled" status if status column exists
      if (colMap.status) {
        const statusStr = (rawStatus || '').toString().toUpperCase();
        const isFill = statusStr.includes('FILL') || statusStr.includes('EXEC') || statusStr === 'BOUGHT' || statusStr === 'SOLD' || statusStr === 'FILLED';
        if (!isFill && statusStr !== '') {
          result.ignoredRowsDetails.push({
            rowNumber: rowNum,
            reason: `Not a fill row (Status: ${rawStatus || 'N/A'})`,
            data: row
          });
          result.summary.ignoredRows++;
          return;
        }
      }

      // 2. Validate required fields
      if (!rawTimestamp) {
        result.ignoredRowsDetails.push({ rowNumber: rowNum, reason: 'Missing timestamp', data: row });
        result.summary.ignoredRows++;
        return;
      }
      if (!rawSymbol) {
        result.ignoredRowsDetails.push({ rowNumber: rowNum, reason: 'Missing symbol', data: row });
        result.summary.ignoredRows++;
        return;
      }

      const side = detectSide(rawSide);
      if (!side) {
        const sideValuesFound: Record<string, any> = {};
        result.summary.sideCandidateFields?.forEach(field => {
          const normField = normalize(field);
          if (row[normField] !== undefined) {
            sideValuesFound[field] = row[normField];
          }
        });

        result.ignoredRowsDetails.push({ 
          rowNumber: rowNum, 
          reason: `Missing or unrecognized side/action (Found: "${rawSide || 'N/A'}" in header "${colMap.side || 'N/A'}")`, 
          data: row,
          sideValuesFound
        });
        result.summary.ignoredRows++;
        return;
      }

      if (rawQuantity === undefined || rawQuantity === null || isNaN(Number(rawQuantity)) || Number(rawQuantity) === 0) {
        result.ignoredRowsDetails.push({ rowNumber: rowNum, reason: 'Invalid or zero quantity', data: row });
        result.summary.ignoredRows++;
        return;
      }
      if (rawPrice === undefined || rawPrice === null || isNaN(Number(rawPrice))) {
        result.ignoredRowsDetails.push({ rowNumber: rowNum, reason: 'Invalid price', data: row });
        result.summary.ignoredRows++;
        return;
      }

      // 3. Validate Timestamp
      const date = new Date(rawTimestamp);
      if (isNaN(date.getTime())) {
        result.ignoredRowsDetails.push({ rowNumber: rowNum, reason: `Invalid date format: ${rawTimestamp}`, data: row });
        result.summary.ignoredRows++;
        return;
      }

      const order: Order = {
        id: uuidv4(),
        userId,
        symbol: rawSymbol.toString(),
        side: side,
        quantity: Math.abs(Number(rawQuantity)),
        price: Number(rawPrice),
        timestamp: date.toISOString(),
        orderType: 'Market',
        status: 'Filled',
        brokerOrderId: rawOrderId?.toString() || `manual-${uuidv4().slice(0, 8)}`,
        source: 'csv',
        order_id: rawOrderId?.toString() || `manual-${uuidv4().slice(0, 8)}`,
        avg_price: Number(rawPrice),
        fill_time: date.toISOString()
      };

      result.orders.push(order);
      symbolsSet.add(order.symbol);
    });

    result.summary.parsedRows = result.orders.length;
    result.summary.validFilledRows = result.orders.length;
    result.summary.symbols = Array.from(symbolsSet);
    result.orders.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  } catch (error) {
    result.errors.push(`Unexpected error during CSV parsing: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

/**
 * Statefully processes a single ingestion event against a position state.
 */
export function processEventStatefully(state: PositionState, event: IngestionEvent): { updatedState: PositionState, closedTrades: Trade[], step?: ReconstructionStep } {
  const closedTrades: Trade[] = [];
  const updatedState = { ...state, fills: [...state.fills], rawOrderIds: [...state.rawOrderIds] };
  
  const side = event.side.toUpperCase();
  const qty = event.quantity;
  const price = event.avgFillPrice;
  const timestamp = event.eventTimestamp;

  const order: Order = {
    id: uuidv4(),
    userId: event.userId,
    symbol: event.symbol,
    side: side === 'BUY' ? 'BUY' : 'SELL',
    quantity: qty,
    price: price,
    timestamp: timestamp,
    orderType: 'Market',
    status: 'Filled',
    brokerOrderId: event.orderId,
    fillId: event.fillId,
    source: event.type === 'csv_upload' ? 'csv' : 'api',
    importRunId: event.importRunId,
    order_id: event.orderId,
    avg_price: price,
    fill_time: timestamp
  };

  updatedState.fills.push(order);
  updatedState.rawOrderIds.push(event.orderId);
  updatedState.lastProcessedEventTimestamp = timestamp;
  updatedState.lastProcessedEventId = event.id;

  const tradeSide = side === 'BUY' ? 1 : -1;
  const prevPosition = updatedState.currentPosition;
  updatedState.currentPosition += (tradeSide * qty);
  updatedState.maxPositionSize = Math.max(updatedState.maxPositionSize || 0, Math.abs(updatedState.currentPosition));

  let step: ReconstructionStep | undefined = {
    id: uuidv4(),
    timestamp,
    type: 'order',
    description: `${side} ${qty} ${event.symbol} @ ${price}`,
    data: { order, prevPosition, newPosition: updatedState.currentPosition },
    time: timestamp,
    action: side,
    side: side,
    quantity: qty,
    price: price,
    currentPosition: updatedState.currentPosition
  };

  if (prevPosition === 0) {
    updatedState.openTradeId = uuidv4();
    updatedState.openTradeDirection = tradeSide === 1 ? 'long' : 'short';
    updatedState.entryTime = timestamp;
    updatedState.entryValue = qty * price;
    updatedState.totalEntryQuantity = qty;
    updatedState.maxPositionSize = qty;
    updatedState.totalExitQuantity = 0;
    updatedState.exitValue = 0;
    step.type = 'trade_open';
  } else if (Math.sign(prevPosition) !== Math.sign(updatedState.currentPosition) && updatedState.currentPosition !== 0) {
    const closingQty = Math.abs(prevPosition);
    updatedState.totalExitQuantity += closingQty;
    updatedState.exitValue += closingQty * price;
    closedTrades.push(createTradeFromState(updatedState, timestamp, price, event.userId));

    const remainderQty = Math.abs(updatedState.currentPosition);
    updatedState.openTradeId = uuidv4();
    updatedState.openTradeDirection = tradeSide === 1 ? 'long' : 'short';
    updatedState.entryTime = timestamp;
    updatedState.entryValue = remainderQty * price;
    updatedState.totalEntryQuantity = remainderQty;
    updatedState.maxPositionSize = remainderQty;
    updatedState.totalExitQuantity = 0;
    updatedState.exitValue = 0;
    updatedState.fills = [order];
    step.type = 'position_update';
  } else if (updatedState.currentPosition === 0) {
    updatedState.totalExitQuantity += qty;
    updatedState.exitValue += qty * price;
    closedTrades.push(createTradeFromState(updatedState, timestamp, price, event.userId));
    updatedState.openTradeId = null;
    updatedState.openTradeDirection = null;
    updatedState.entryTime = null;
    updatedState.entryValue = 0;
    updatedState.exitValue = 0;
    updatedState.totalEntryQuantity = 0;
    updatedState.totalExitQuantity = 0;
    updatedState.maxPositionSize = 0;
    updatedState.fills = [];
    updatedState.rawOrderIds = [];
    step.type = 'trade_close';
  } else {
    if (Math.sign(tradeSide) === Math.sign(prevPosition)) {
      updatedState.entryValue += qty * price;
      updatedState.totalEntryQuantity += qty;
    } else {
      updatedState.exitValue += qty * price;
      updatedState.totalExitQuantity += qty;
    }
    step.type = 'position_update';
  }

  updatedState.updatedAt = new Date().toISOString();
  return { updatedState, closedTrades, step };
}

function calculateDiagnostics(truth: TradeTruth, metrics: TradeDerivedMetrics): TradeDiagnostics {
  const pnlResult = truth.pnlPoints > 0 ? 'WIN' : (truth.pnlPoints < 0 ? 'LOSS' : 'BREAKEVEN');
  
  const holdTime = truth.holdTimeSeconds;
  let holdType: 'SCALP' | 'INTRADAY' | 'SWING';
  if (holdTime < 60) holdType = 'SCALP';
  else if (holdTime <= 1800) holdType = 'INTRADAY';
  else holdType = 'SWING';

  const entryFills = truth.fills.filter(f => f.side === (truth.direction === 'LONG' ? 'BUY' : 'SELL'));
  const exitFills = truth.fills.filter(f => f.side === (truth.direction === 'LONG' ? 'SELL' : 'BUY'));
  
  const isScaledIn = entryFills.length > 1;
  const isScaledOut = exitFills.length > 1;
  
  let executionType: 'SINGLE_ENTRY' | 'SCALED_IN' | 'SCALED_OUT' | 'FULL_SCALE';
  if (isScaledIn && isScaledOut) executionType = 'FULL_SCALE';
  else if (isScaledIn) executionType = 'SCALED_IN';
  else if (isScaledOut) executionType = 'SCALED_OUT';
  else executionType = 'SINGLE_ENTRY';

  const efficiency = 0; 

  let dataInsight = "";
  if (pnlResult === 'WIN' && executionType === 'SINGLE_ENTRY') {
    dataInsight = "Single-entry trade closed profitably.";
  } else if (pnlResult === 'WIN' && holdType === 'INTRADAY') {
    dataInsight = "Intraday trade closed in profit.";
  } else if (pnlResult === 'LOSS' && holdType === 'SCALP') {
    dataInsight = "Short-duration trade resulted in a loss.";
  } else if (pnlResult === 'LOSS' && executionType === 'SCALED_IN') {
    dataInsight = "Scaled position increased exposure before closing at a loss.";
  } else if (pnlResult === 'WIN' && executionType === 'SCALED_OUT') {
    dataInsight = "Scaled exit used to realize profit.";
  } else {
    const outcome = pnlResult === 'WIN' ? 'profit' : (pnlResult === 'LOSS' ? 'loss' : 'breakeven');
    dataInsight = `${holdType} trade closed with ${outcome} via ${executionType} execution.`;
  }

  return {
    pnlResult,
    holdType,
    executionType,
    efficiency,
    dataInsight
  };
}

function createTradeFromState(state: PositionState, exitTime: string, exitPrice: number, userId: string = ''): Trade {
  const pnlPoints = (state.exitValue - state.entryValue) * (state.openTradeDirection === 'long' ? 1 : -1);
  const grossPnlCurrency = Number((pnlPoints * getPointValue(state.symbol)).toFixed(2));
  // Commission is charged per contract per fill (each entry fill and each exit fill
  // is its own transaction), so sum quantity across every fill that made up this trade.
  const commissionRate = getCommissionPerContract(state.symbol);
  const totalCommission = Number((state.fills.reduce((sum, f) => sum + f.quantity, 0) * commissionRate).toFixed(2));
  const realizedPnL = Number((grossPnlCurrency - totalCommission).toFixed(2));
  const holdTimeSeconds = state.entryTime ? (new Date(exitTime).getTime() - new Date(state.entryTime).getTime()) / 1000 : 0;
  
  const sessionDate = state.entryTime ? state.entryTime.split('T')[0] : exitTime.split('T')[0];
  const sessionId = userId ? `${userId}_${sessionDate}` : uuidv4();

  const truth: TradeTruth = {
    id: state.openTradeId || uuidv4(),
    userId: userId,
    sessionId: sessionId,
    sessionDate: sessionDate,
    symbol: state.symbol,
    direction: state.openTradeDirection === 'long' ? 'LONG' : 'SHORT',
    entryTime: state.entryTime || exitTime,
    exitTime: exitTime,
    avgEntryPrice: state.entryValue / state.totalEntryQuantity,
    avgExitPrice: state.exitValue / state.totalExitQuantity,
    totalQuantity: state.totalEntryQuantity,
    pnlPoints: Number(pnlPoints.toFixed(2)),
    pnlCurrency: realizedPnL,
    isWinner: pnlPoints > 0,
    holdTimeSeconds: Math.round(holdTimeSeconds),
    fills: state.fills,
    dedupeHash: `${state.accountId}_${state.symbol}_${state.entryTime}_${exitTime}`,
    totalEntryValue: Number(state.entryValue.toFixed(2)),
    totalExitValue: Number(state.exitValue.toFixed(2)),
    realizedPnL: realizedPnL,
    maxPositionSize: state.maxPositionSize,
    grossPnlCurrency,
    totalCommission
  };

  const metrics: TradeDerivedMetrics = {
    riskRewardRatio: 0,
    mae: 0,
    mfe: 0,
    efficiency: 0,
    isFastLoser: holdTimeSeconds < 60 && pnlPoints < 0,
    isReentry: false,
    isLargeWinner: false,
    isLargeLoser: false,
    orderCount: state.fills.length
  };

  const diagnostics = calculateDiagnostics(truth, metrics);

  const review: TradeReview = {
    tradeGrade: 'C',
    executionQuality: 50,
    strategyQuality: 50,
    entryQuality: 50,
    exitQuality: 50,
    timingScore: 50,
    behaviorFlags: [],
    tags: [],
    verdict: diagnostics.dataInsight,
    lessonLearned: '',
    diagnostics
  };

  return { ...truth, ...metrics, ...review };
}

export function reconstructTradesStatefully(connectionId: string, accountId: string, symbol: string, events: IngestionEvent[]): { trades: Trade[], steps: ReconstructionStep[] } {
  let state: PositionState = {
    id: `${connectionId}_${accountId}_${symbol}`,
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
    updatedAt: new Date().toISOString(),
    maxPositionSize: 0
  };

  const trades: Trade[] = [];
  const steps: ReconstructionStep[] = [];
  events.sort((a, b) => new Date(a.eventTimestamp).getTime() - new Date(b.eventTimestamp).getTime());

  for (const event of events) {
    const result = processEventStatefully(state, event);
    state = result.updatedState;
    trades.push(...result.closedTrades);
    if (result.step) steps.push(result.step);
  }
  return { trades, steps };
}

export function reconstructTrades(orders: Order[]): { trades: Trade[], steps: ReconstructionStep[] } {
  if (orders.length === 0) return { trades: [], steps: [] };
  const ordersBySymbol: Record<string, Order[]> = {};
  orders.forEach(o => {
    if (!ordersBySymbol[o.symbol]) ordersBySymbol[o.symbol] = [];
    ordersBySymbol[o.symbol].push(o);
  });
  const allTrades: Trade[] = [];
  const allSteps: ReconstructionStep[] = [];
  for (const [symbol, symbolOrders] of Object.entries(ordersBySymbol)) {
    const events: IngestionEvent[] = symbolOrders.map(o => ({
      id: o.id,
      userId: o.userId,
      connectionId: 'manual',
      accountId: o.accountId || 'manual',
      type: 'csv_upload',
      status: 'completed',
      processingStatus: 'processed',
      timestamp: o.timestamp,
      eventTimestamp: o.timestamp,
      symbol: o.symbol,
      side: o.side,
      quantity: o.quantity,
      avgFillPrice: o.price,
      orderId: o.brokerOrderId || o.id,
      payload: o
    }));
    const { trades, steps } = reconstructTradesStatefully('manual', 'manual', symbol, events);
    allTrades.push(...trades);
    allSteps.push(...steps);
  }
  return { trades: allTrades, steps: allSteps };
}
