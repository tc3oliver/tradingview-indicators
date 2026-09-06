// Single source of truth for endpoints, fees and paths.
// Nothing here is hard-coded as an eternal fact: every exchange-side number carries
// the date it was read and where it came from, and every one of them is overridable
// from the environment so a change on Binance's side is a config edit, not a patch.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA_VERSION = 'v1';           // bump on any change to event or feature semantics
export const COLLECTOR_VERSION = '1.0.0';

export const SYMBOL = process.env.M2_SYMBOL || 'BTCUSDT';
const lower = SYMBOL.toLowerCase();

// Observed 2026-09-06 by research/probe/probe.mjs, not taken from prose:
//   - btcusdt@depth@100ms and btcusdt@bookTicker are served on  /stream
//   - btcusdt@aggTrade is served ONLY on                        /market
//     (/ws, /stream and /public/stream all delivered zero aggTrade messages)
// Hence two connections. See research/LITERATURE-M2.md §1.
export const WS = {
  depth: `wss://fstream.binance.com/stream?streams=${lower}@depth@100ms`,
  trades: `wss://fstream.binance.com/market/stream?streams=${lower}@aggTrade`,
  routeCheckedAt: '2026-09-06',
};
export const REST = {
  depthSnapshot: `https://fapi.binance.com/fapi/v1/depth?symbol=${SYMBOL}&limit=1000`,
  exchangeInfo: 'https://fapi.binance.com/fapi/v1/exchangeInfo',
};

// A single connection is valid for 24 hours; the server pings every 3 minutes and
// drops a connection that has not ponged within 10 minutes. Node's WebSocket answers
// pings automatically, so what we enforce is our own staleness watchdog.
export const WS_LIMITS = {
  connectionMaxHours: 24,
  serverPingMinutes: 3,
  pongWindowMinutes: 10,
  incomingMessagesPerSecond: 10,     // limit on messages we may SEND
  maxStreamsPerConnection: 1024,
  documentedAt: '2026-09-06',
  source: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Connect',
};
export const RECONNECT_HOURS = Number(process.env.M2_RECONNECT_HOURS || 12);   // well inside the 24h cap
export const STALE_MS = Number(process.env.M2_STALE_MS || 5000);               // feed considered stale after this

// ---------------------------------------------------------------- fee model
// Binance USDⓈ-M futures, Regular User / VIP 0, read 2026-09-06.
// Source: Binance fee schedule (https://www.binance.com/en/fee/futureFee), cross-checked
// against public fee summaries on the same date. BNB discount NOT applied.
export const FEES = {
  readAt: '2026-09-06',
  source: 'Binance USDⓈ-M futures fee schedule, Regular User / VIP 0',
  takerBp: Number(process.env.M2_TAKER_BP || 5),      // 0.0500% per side
  makerBp: Number(process.env.M2_MAKER_BP || 2),      // 0.0200% per side
  bnbDiscount: 0.10,                                  // available, deliberately not assumed
};

// Three cost profiles. Nothing may pass an economic gate on a maker profile: a resting
// order is not a fill, and we have no defensible queue model. See PART C7 of the M2
// pre-registration.
export const COST_PROFILES = {
  A: { id: 'A', name: 'commission-only taker', roundTripBp: 2 * FEES.takerBp,
    note: 'VIP 0 taker commission both sides. Spread and book impact are measured separately from the live book and added on top.',
    usableForAcceptance: true },
  B: { id: 'B', name: 'conservative taker', roundTripBp: 14,
    note: 'The all-in baseline carried from IT1/IT2/IT3/M1 (0.14% = 14 bp round trip). Commission plus a spread and impact allowance.',
    usableForAcceptance: true },
  C: { id: 'C', name: 'stress taker', roundTripBp: 20,
    note: 'Stress case (0.20% = 20 bp round trip).',
    usableForAcceptance: true },
  M: { id: 'M', name: 'maker (NOT usable for acceptance)', roundTripBp: 2 * FEES.makerBp,
    note: 'Recorded for execution research only. A limit order placed is not a limit order filled; without a defensible queue model this profile may never be used to pass a directional gate.',
    usableForAcceptance: false },
};

// 0.14% is 14 bp, not 140 bp. Regression-tested in tests/execution.test.mjs.
export const pctToBp = (pct) => pct * 10000;
export const bpToPct = (bp) => bp / 10000;

// ---------------------------------------------------------------- planner
export const PLANNER = {
  port: Number(process.env.M2_PORT || 8787),
  defaultNotionalUsd: 10000,
  presetNotionalUsd: [1000, 10000, 50000, 100000],
  // No default verdict is invented: with no user limit the planner shows the numbers
  // and refuses to grade them. See PART A4.
  maxAllInCostBp: process.env.M2_MAX_COST_BP ? Number(process.env.M2_MAX_COST_BP) : null,
};

// ---------------------------------------------------------------- storage
export const PATHS = {
  data: resolve(ROOT, 'data'),
  events: resolve(ROOT, 'data', 'l2', SCHEMA_VERSION),
  manifest: resolve(ROOT, 'data', 'MANIFEST.json'),
  prospective: resolve(ROOT, 'data', 'PROSPECTIVE.json'),
  // Written by the M2 pre-registration commit. Until this file exists the collector
  // cannot leave WARMUP, so engineering data can never be relabelled as prospective.
  freeze: resolve(ROOT, 'research', 'M2-FREEZE.json'),
  state: resolve(ROOT, 'data', 'collector-state.json'),
};

// Depth levels the book keeps. The REST snapshot gives 1000 per side; diffs can touch
// any price, so the book is kept complete rather than truncated.
export const BOOK = {
  snapshotLimit: 1000,
  featureHz: 1,                       // one feature record per second
  depthBands: [1, 2, 5, 10],          // bp from mid, for depth-within-band measures
  topLevels: [1, 5, 10],
  flowWindowsMs: [1000, 5000, 30000],
};
