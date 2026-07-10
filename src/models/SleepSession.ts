import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { MetadataSchema } from '../lib/healthconnect';

/**
 * One Health Connect sleep session, as delivered by HC Webhook.
 *
 * Payload quirk (docs/webhook.md of mcnaveen/health-connect-webhook):
 * the `sleep` record carries `session_end_time` + `duration_seconds`
 * but NO explicit start time — we derive `sessionStartTime` on ingest.
 */
const SleepStageSchema = new Schema(
  {
    stage: { type: String, required: true }, // mapped name: AWAKE / LIGHT / DEEP / REM / ...
    stageCode: { type: String }, // raw payload value, e.g. "4"
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    durationSeconds: { type: Number, required: true },
  },
  { _id: false },
);

const SleepSessionSchema = new Schema(
  {
    // Derived: sessionEndTime - durationSeconds
    sessionStartTime: { type: Date, required: true },
    sessionEndTime: { type: Date, required: true, unique: true },
    durationSeconds: { type: Number, required: true },
    stages: { type: [SleepStageSchema], default: [] },

    // Per-stage totals in seconds, precomputed for cheap querying.
    stageTotals: {
      type: Map,
      of: Number,
      default: undefined,
    },

    source: { type: String, default: 'hc-webhook' },
    metadata: { type: MetadataSchema },
    appVersion: { type: String },
    receivedAt: { type: Date, default: () => new Date() },
  },
  {
    timestamps: true,
    collection: 'sleep_sessions',
  },
);

SleepSessionSchema.index({ sessionStartTime: -1 });

export type SleepSession = InferSchemaType<typeof SleepSessionSchema>;

// Guard against model re-compilation during dev-mode HMR.
export const SleepSessionModel: Model<SleepSession> =
  (mongoose.models.SleepSession as Model<SleepSession>) ??
  mongoose.model<SleepSession>('SleepSession', SleepSessionSchema);
