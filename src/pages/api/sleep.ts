import type { APIRoute } from 'astro';
import { connectDb } from '../../lib/db';
import { SleepSessionModel } from '../../models/SleepSession';

export const prerender = false;

const TZ = process.env.TIMEZONE ?? 'Europe/Amsterdam';

/**
 * GET /api/sleep?date=yesterday
 * GET /api/sleep?date=2026-07-08
 * GET /api/sleep            → last 14 sessions
 *
 * "The night of <date>" = any session that ENDS on that calendar day
 * in the configured timezone — i.e. the sleep you woke up from that day.
 */
export const GET: APIRoute = async ({ url }) => {
  await connectDb();

  const dateParam = url.searchParams.get('date');

  if (!dateParam) {
    const sessions = await SleepSessionModel.find()
      .sort({ sessionEndTime: -1 })
      .limit(14)
      .lean();
    return json({ timezone: TZ, sessions: sessions.map(serialize) });
  }

  let day: string; // YYYY-MM-DD in TZ
  if (dateParam === 'yesterday' || dateParam === 'today') {
    const now = new Date();
    if (dateParam === 'yesterday') now.setUTCDate(now.getUTCDate() - 1);
    day = formatDay(now);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    day = dateParam;
  } else {
    return json({ error: "date must be 'today', 'yesterday' or YYYY-MM-DD" }, 400);
  }

  // Sessions ending on that local calendar day. A generous UTC window
  // around the day, then filter precisely by local date.
  const windowStart = new Date(`${day}T00:00:00Z`);
  windowStart.setUTCHours(windowStart.getUTCHours() - 14);
  const windowEnd = new Date(`${day}T23:59:59Z`);
  windowEnd.setUTCHours(windowEnd.getUTCHours() + 14);

  const candidates = await SleepSessionModel.find({
    sessionEndTime: { $gte: windowStart, $lte: windowEnd },
  })
    .sort({ sessionEndTime: 1 })
    .lean();

  const sessions = candidates.filter((s) => formatDay(s.sessionEndTime) === day);

  return json({ date: day, timezone: TZ, sessions: sessions.map(serialize) });
};

function formatDay(d: Date): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

function localTime(d: Date): string {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function serialize(s: any) {
  return {
    sleptFrom: s.sessionStartTime,
    sleptUntil: s.sessionEndTime,
    localFrom: localTime(s.sessionStartTime),
    localUntil: localTime(s.sessionEndTime),
    durationSeconds: s.durationSeconds,
    durationPretty: pretty(s.durationSeconds),
    stageTotals: s.stageTotals ?? {},
    stages: s.stages?.map((st: any) => ({
      stage: st.stage,
      startTime: st.startTime,
      endTime: st.endTime,
      durationSeconds: st.durationSeconds,
    })),
  };
}

function pretty(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
