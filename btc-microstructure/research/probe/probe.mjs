// Records the ACTUAL payloads of the endpoints M2 depends on, so the parser is
// written against observed shape rather than against documentation prose.
// Usage: node research/probe/probe.mjs > research/probe/payloads.json
const out = { at: new Date().toISOString(), rest: {}, ws: {} };
const j = async (u) => (await fetch(u)).json();

const depth = await j('https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000');
out.rest.depth = { keys: Object.keys(depth), lastUpdateId: depth.lastUpdateId, E: depth.E, T: depth.T,
  bidsLen: depth.bids.length, asksLen: depth.asks.length, bid0: depth.bids[0], ask0: depth.asks[0],
  levelShape: `array of ${depth.bids[0].length} strings` };
const ex = await j('https://fapi.binance.com/fapi/v1/exchangeInfo');
const s = ex.symbols.find((x) => x.symbol === 'BTCUSDT');
out.rest.exchangeInfo = { symbol: s.symbol, status: s.status, contractType: s.contractType,
  pricePrecision: s.pricePrecision, quantityPrecision: s.quantityPrecision,
  filters: s.filters.filter((f) => ['PRICE_FILTER', 'LOT_SIZE', 'MARKET_LOT_SIZE', 'MIN_NOTIONAL'].includes(f.filterType)) };

const url = 'wss://fstream.binance.com/stream?streams=btcusdt@depth@100ms/btcusdt@aggTrade/btcusdt@bookTicker';
const ws = new WebSocket(url);
const seen = {};
await new Promise((res, rej) => {
  const timer = setTimeout(() => { try { ws.close(); } catch {} res(); }, 12000);
  ws.onerror = (e) => { clearTimeout(timer); rej(new Error('ws error ' + (e.message || ''))); };
  ws.onmessage = (m) => {
    const p = JSON.parse(m.data);
    const st = p.stream;
    seen[st] = seen[st] || { count: 0, first: p.data, keys: Object.keys(p.data) };
    seen[st].count++;
    seen[st].last = p.data;
    if (Object.keys(seen).length >= 3 && Object.values(seen).every((x) => x.count >= 5)) { clearTimeout(timer); try { ws.close(); } catch {} res(); }
  };
});
for (const [k, v] of Object.entries(seen)) {
  out.ws[k] = { messages: v.count, keys: v.keys, sample: v.first };
  if (k.endsWith('@depth@100ms')) out.ws[k].continuity = { firstU: v.first.U, firstu: v.first.u, firstpu: v.first.pu, lastU: v.last.U, lastu: v.last.u, lastpu: v.last.pu };
}
console.log(JSON.stringify(out, null, 2));
