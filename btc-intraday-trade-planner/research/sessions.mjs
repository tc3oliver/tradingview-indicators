// DST-correct session logic, shared by the audit and the engine.
//
// Every session is defined in its own IANA timezone, exactly as Pine's
// time(timeframe.period, "0800-1630", "Europe/London") would define it, and a
// bar belongs to a session when its OPEN time falls inside the window on a
// local Monday-Friday. Local clock time comes from Intl, so the UTC offset of
// London/New York moves with DST instead of being hard-coded.

const fmtCache = new Map();
const fmt = (tz) => {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }));
  return fmtCache.get(tz);
};
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// { hm: minutes since local midnight, dow: 0..6 }
export function local(ms, tz) {
  const parts = fmt(tz).formatToParts(new Date(ms));
  let h = 0, m = 0, w = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = +p.value % 24;
    else if (p.type === 'minute') m = +p.value;
    else if (p.type === 'weekday') w = DOW[p.value];
  }
  return { hm: h * 60 + m, dow: w };
}

export const SESSIONS = {
  ASIA:   { tz: 'Asia/Tokyo',       start: 9 * 60,       end: 15 * 60,      orBars: 4 }, // TSE hours; Japan has no DST
  LONDON: { tz: 'Europe/London',    start: 8 * 60,       end: 16 * 60 + 30, orBars: 4 }, // LSE hours
  NY:     { tz: 'America/New_York', start: 9 * 60 + 30,  end: 16 * 60,      orBars: 4 }, // NYSE hours
};

export const M15 = 15 * 60_000;

// Per-bar session flags. inX: bar opens inside session X on a local weekday.
// lastX: bar is the final bar of session X (its close time == session end).
export function sessionFlags(t) {
  const out = {};
  for (const [k, s] of Object.entries(SESSIONS)) {
    const a = local(t, s.tz), b = local(t + M15, s.tz);
    const weekday = a.dow >= 1 && a.dow <= 5;
    out['in' + k] = weekday && a.hm >= s.start && a.hm < s.end;
    out['last' + k] = out['in' + k] && b.hm === s.end;
    out['first' + k] = out['in' + k] && a.hm === s.start;
  }
  return out;
}

export const utcDay = (t) => Math.floor(t / 86400_000);
