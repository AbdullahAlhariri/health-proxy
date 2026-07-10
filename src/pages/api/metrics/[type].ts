import type { APIRoute } from 'astro';
import { connectDb } from '../../../lib/db';
import {
  StepIntervalModel,
  DistanceIntervalModel,
  HeartRateSampleModel,
  ExerciseSessionModel,
} from '../../../models/Metrics';

export const prerender = false;

const TZ = process.env.TIMEZONE ?? 'Europe/Amsterdam';

/**
 * GET /api/metrics/steps?date=yesterday        → daily bucket(s) starting that day
 * GET /api/metrics/distance?date=2026-07-08
 * GET /api/metrics/heart_rate?date=today       → all samples that day + min/avg/max
 * GET /api/metrics/exercise?date=yesterday     → sessions starting that day
 * Without ?date: the most recent records (capped).
 */
export const GET: APIRoute = async ({ params, url }) => {
  await connectDb();

  const type = params.type;
  const dateParam = url.searchParams.get('date');

  let range: { from: Date; to: Date } | null = null;
  if (dateParam) {
    const day = resolveDay(dateParam);
    if (!day) {
      return json({ error: "date must be 'today', 'yesterday' or YYYY-MM-DD" }, 400);
    }
    range = localDayRange(day);
  }

  switch (type) {
    case 'steps': {
      const q = range ? { startTime: { $gte: range.from, $lt: range.to } } : {};
      const docs = await StepIntervalModel.find(q)
        .sort({ startTime: -1 })
        .limit(range ? 100 : 14)
        .lean();
      return json({
        timezone: TZ,
        totalCount: docs.reduce((a, d) => a + d.count, 0),
        intervals: docs,
      });
    }

    case 'distance': {
      const q = range ? { startTime: { $gte: range.from, $lt: range.to } } : {};
      const docs = await DistanceIntervalModel.find(q)
        .sort({ startTime: -1 })
        .limit(range ? 100 : 14)
        .lean();
      return json({
        timezone: TZ,
        totalMeters: docs.reduce((a, d) => a + d.meters, 0),
        intervals: docs,
      });
    }

    case 'heart_rate': {
      const q = range ? { time: { $gte: range.from, $lt: range.to } } : {};
      const docs = await HeartRateSampleModel.find(q)
        .sort({ time: range ? 1 : -1 })
        .limit(range ? 5000 : 100)
        .lean();
      const bpms = docs.map((d) => d.bpm);
      return json({
        timezone: TZ,
        samples: docs.length,
        min: bpms.length ? Math.min(...bpms) : null,
        max: bpms.length ? Math.max(...bpms) : null,
        avg: bpms.length
          ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length)
          : null,
        data: docs,
      });
    }

    case 'exercise': {
      const q = range ? { startTime: { $gte: range.from, $lt: range.to } } : {};
      const docs = await ExerciseSessionModel.find(q)
        .sort({ startTime: -1 })
        .limit(range ? 100 : 20)
        .lean();
      return json({ timezone: TZ, sessions: docs });
    }

    default:
      return json(
        { error: 'unknown type', supported: ['steps', 'distance', 'heart_rate', 'exercise'] },
        404,
      );
  }
};

function resolveDay(param: string): string | null {
  if (param === 'today' || param === 'yesterday') {
    const now = new Date();
    if (param === 'yesterday') now.setUTCDate(now.getUTCDate() - 1);
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : null;
}

/** UTC instants spanning [00:00, 24:00) of a local calendar day in TZ. */
function localDayRange(day: string): { from: Date; to: Date } {
  const probe = new Date(`${day}T12:00:00Z`);
  // Offset (minutes) of TZ at that date, via the sv-SE trick.
  const local = new Date(
    probe.toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T') + 'Z',
  );
  const offsetMin = (local.getTime() - probe.getTime()) / 60000;
  const from = new Date(new Date(`${day}T00:00:00Z`).getTime() - offsetMin * 60000);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
