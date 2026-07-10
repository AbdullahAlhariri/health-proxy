import type { APIRoute } from 'astro';
import { z } from 'zod';
import { connectDb } from '../../../lib/db';
import {
  sleepStageName,
  exerciseTypeName,
  mapMetadata,
} from '../../../lib/healthconnect';
import { SleepSessionModel } from '../../../models/SleepSession';
import { RawPayloadModel } from '../../../models/RawPayload';
import {
  StepIntervalModel,
  DistanceIntervalModel,
  HeartRateSampleModel,
  ExerciseSessionModel,
} from '../../../models/Metrics';

export const prerender = false;

/**
 * Receiver for the HC Webhook app (mcnaveen/health-connect-webhook).
 * Ingests: sleep, steps, heart_rate, distance, exercise.
 * Other enabled data types still land in the raw archive.
 *
 * Auth: configure a custom header per webhook URL in the app:
 *   X-Webhook-Secret: <WEBHOOK_SECRET>
 *
 * Idempotency rules (HC Webhook retries and re-sends windows):
 *   sleep      → upsert on session_end_time
 *   steps      → upsert on start_time  (last daily bucket is partial & grows)
 *   distance   → upsert on start_time  (same rolling-bucket behavior)
 *   heart_rate → bulk upsert on sample time
 *   exercise   → upsert on start_time
 */

const MetadataSchema = z
  .object({
    data_origin: z.string().optional(),
    recording_method: z.string().optional(),
    device: z.unknown().optional(),
  })
  .passthrough()
  .optional();

const StageSchema = z.object({
  stage: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  duration_seconds: z.number(),
});

const SleepRecordSchema = z.object({
  session_end_time: z.string(),
  duration_seconds: z.number(),
  stages: z.array(StageSchema).default([]),
  metadata: MetadataSchema,
});

const StepsRecordSchema = z.object({
  count: z.number(),
  start_time: z.string(),
  end_time: z.string(),
  metadata: MetadataSchema,
});

const HeartRateRecordSchema = z.object({
  bpm: z.number(),
  time: z.string(),
  metadata: MetadataSchema,
});

const DistanceRecordSchema = z.object({
  meters: z.number(),
  start_time: z.string(),
  end_time: z.string(),
  metadata: MetadataSchema,
});

const ExerciseRecordSchema = z.object({
  type: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  duration_seconds: z.number(),
  distance_meters: z.number().optional(),
  steps: z.number().optional(),
  avg_cadence_spm: z.number().optional(),
  max_cadence_spm: z.number().optional(),
  stride_length_m: z.number().optional(),
  metadata: MetadataSchema,
});

const PayloadSchema = z
  .object({
    timestamp: z.string(),
    app_version: z.string().optional(),
    sleep: z.array(SleepRecordSchema).optional(),
    steps: z.array(StepsRecordSchema).optional(),
    heart_rate: z.array(HeartRateRecordSchema).optional(),
    distance: z.array(DistanceRecordSchema).optional(),
    exercise: z.array(ExerciseRecordSchema).optional(),
  })
  .passthrough(); // future data types pass through to the raw archive

export const POST: APIRoute = async ({ request }) => {
  // --- auth -----------------------------------------------------------
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && request.headers.get('x-webhook-secret') !== secret) {
    return json({ error: 'unauthorized' }, 401);
  }

  // --- parse ----------------------------------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'schema mismatch', details: parsed.error.flatten() }, 422);
  }
  const payload = parsed.data;

  await connectDb();

  // --- archive the raw delivery ----------------------------------------
  const dataTypes = Object.keys(payload).filter(
    (k) => k !== 'timestamp' && k !== 'app_version',
  );
  await RawPayloadModel.create({
    payloadTimestamp: new Date(payload.timestamp),
    appVersion: payload.app_version,
    dataTypes,
    body: payload,
  });

  const counts: Record<string, number> = {};

  // --- sleep -----------------------------------------------------------
  for (const record of payload.sleep ?? []) {
    const end = new Date(record.session_end_time);
    // Payload quirk: no explicit start time — derive it.
    const start = new Date(end.getTime() - record.duration_seconds * 1000);

    const stages = record.stages.map((s) => ({
      stage: sleepStageName(s.stage),
      stageCode: s.stage,
      startTime: new Date(s.start_time),
      endTime: new Date(s.end_time),
      durationSeconds: s.duration_seconds,
    }));

    const stageTotals: Record<string, number> = {};
    for (const s of stages) {
      stageTotals[s.stage] = (stageTotals[s.stage] ?? 0) + s.durationSeconds;
    }

    await SleepSessionModel.updateOne(
      { sessionEndTime: end },
      {
        $set: {
          sessionStartTime: start,
          durationSeconds: record.duration_seconds,
          stages,
          stageTotals,
          metadata: mapMetadata(record.metadata),
          appVersion: payload.app_version,
        },
        $setOnInsert: { receivedAt: new Date() },
      },
      { upsert: true },
    );
    counts.sleep = (counts.sleep ?? 0) + 1;
  }

  // --- steps (rolling daily buckets → key on startTime) ------------------
  for (const record of payload.steps ?? []) {
    await StepIntervalModel.updateOne(
      { startTime: new Date(record.start_time) },
      {
        $set: {
          endTime: new Date(record.end_time),
          count: record.count,
          metadata: mapMetadata(record.metadata),
        },
        $setOnInsert: { receivedAt: new Date() },
      },
      { upsert: true },
    );
    counts.steps = (counts.steps ?? 0) + 1;
  }

  // --- distance (same rolling-bucket behavior) ---------------------------
  for (const record of payload.distance ?? []) {
    await DistanceIntervalModel.updateOne(
      { startTime: new Date(record.start_time) },
      {
        $set: {
          endTime: new Date(record.end_time),
          meters: record.meters,
          metadata: mapMetadata(record.metadata),
        },
        $setOnInsert: { receivedAt: new Date() },
      },
      { upsert: true },
    );
    counts.distance = (counts.distance ?? 0) + 1;
  }

  // --- heart rate (bulk: can be >1000 samples per delivery) --------------
  if (payload.heart_rate?.length) {
    const ops = payload.heart_rate.map((r) => ({
      updateOne: {
        filter: { time: new Date(r.time) },
        update: {
          $set: { bpm: r.bpm, metadata: mapMetadata(r.metadata) },
        },
        upsert: true,
      },
    }));
    const result = await HeartRateSampleModel.bulkWrite(ops, { ordered: false });
    counts.heart_rate =
      result.upsertedCount + result.modifiedCount + result.matchedCount;
  }

  // --- exercise ----------------------------------------------------------
  for (const record of payload.exercise ?? []) {
    await ExerciseSessionModel.updateOne(
      { startTime: new Date(record.start_time) },
      {
        $set: {
          endTime: new Date(record.end_time),
          durationSeconds: record.duration_seconds,
          typeCode: record.type,
          typeName: exerciseTypeName(record.type),
          distanceMeters: record.distance_meters,
          steps: record.steps,
          avgCadenceSpm: record.avg_cadence_spm,
          maxCadenceSpm: record.max_cadence_spm,
          strideLengthM: record.stride_length_m,
          metadata: mapMetadata(record.metadata),
        },
        $setOnInsert: { receivedAt: new Date() },
      },
      { upsert: true },
    );
    counts.exercise = (counts.exercise ?? 0) + 1;
  }

  return json({ ok: true, received: dataTypes, ingested: counts });
};

// HC Webhook treats any 2xx as delivered; everything else gets retried.
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
