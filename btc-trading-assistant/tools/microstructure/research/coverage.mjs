// Prospective sample coverage against the pre-registered minimum (PART C1).
// Cheap version reads the manifest only; the research runner uses the same numbers so
// the status page and the gate can never disagree.
import { existsSync, readFileSync } from 'node:fs';
import { PATHS } from '../collector/config.mjs';

export const GATE = {
  minCalendarDays: 30,
  minWeekdayDays: 20,
  minWeekendDays: 8,
  minValidBookHours: 600,          // 30 days x 20 h; allows for resyncs and downtime
  minVolatilityStates: 3,          // low / mid / high terciles must all be represented
};

const isWeekend = (iso) => { const d = new Date(iso + 'T00:00:00Z').getUTCDay(); return d === 0 || d === 6; };

export function coverage() {
  const manifest = existsSync(PATHS.manifest) ? JSON.parse(readFileSync(PATHS.manifest, 'utf8')) : { partitions: {} };
  const prospective = existsSync(PATHS.prospective) ? JSON.parse(readFileSync(PATHS.prospective, 'utf8')) : { startedAt: null };

  const perDay = {};
  for (const p of Object.values(manifest.partitions)) {
    if (p.kind !== 'features') continue;
    const n = p.phases?.prospective ?? 0;
    if (!n) continue;
    perDay[p.day] = (perDay[p.day] || 0) + n;                // 1 Hz => seconds of valid book
  }
  const days = Object.keys(perDay).sort();
  const weekdayDays = days.filter((d) => !isWeekend(d));
  const weekendDays = days.filter(isWeekend);
  const validSeconds = Object.values(perDay).reduce((s, x) => s + x, 0);
  const validHours = validSeconds / 3600;

  const met = {
    calendarDays: days.length >= GATE.minCalendarDays,
    weekdayDays: weekdayDays.length >= GATE.minWeekdayDays,
    weekendDays: weekendDays.length >= GATE.minWeekendDays,
    validBookHours: validHours >= GATE.minValidBookHours,
  };
  return {
    prospectiveStart: prospective.startedAt,
    days: days.length, weekdayDays: weekdayDays.length, weekendDays: weekendDays.length,
    validSeconds, validHours, perDay,
    diskBytes: manifest.diskBytes ?? 0,
    gate: GATE, met,
    // volatility-state coverage needs the feature series and is filled in by m2.mjs
    sampleGatePassed: Object.values(met).every(Boolean),
    progress: {
      calendarDays: `${days.length} / ${GATE.minCalendarDays}`,
      weekdayDays: `${weekdayDays.length} / ${GATE.minWeekdayDays}`,
      weekendDays: `${weekendDays.length} / ${GATE.minWeekendDays}`,
      validBookHours: `${validHours.toFixed(1)} / ${GATE.minValidBookHours}`,
    },
  };
}
