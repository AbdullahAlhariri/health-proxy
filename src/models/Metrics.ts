import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { MetadataSchema } from '../lib/healthconnect';

/**
 * Interval metrics (steps, distance) arrive as rolling local-day buckets:
 * the newest bucket is PARTIAL and keeps growing — its end_time and value
 * change on every sync. So the idempotency key is startTime alone, and
 * upserts overwrite count/endTime with the latest snapshot.
 */

// --- steps ---------------------------------------------------------------

const StepIntervalSchema = new Schema(
  {
    startTime: { type: Date, required: true, unique: true },
    endTime: { type: Date, required: true },
    count: { type: Number, required: true },
    metadata: { type: MetadataSchema },
    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, collection: 'step_intervals' },
);

export type StepInterval = InferSchemaType<typeof StepIntervalSchema>;
export const StepIntervalModel: Model<StepInterval> =
  (mongoose.models.StepInterval as Model<StepInterval>) ??
  mongoose.model<StepInterval>('StepInterval', StepIntervalSchema);

// --- distance ------------------------------------------------------------

const DistanceIntervalSchema = new Schema(
  {
    startTime: { type: Date, required: true, unique: true },
    endTime: { type: Date, required: true },
    meters: { type: Number, required: true },
    metadata: { type: MetadataSchema },
    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, collection: 'distance_intervals' },
);

export type DistanceInterval = InferSchemaType<typeof DistanceIntervalSchema>;
export const DistanceIntervalModel: Model<DistanceInterval> =
  (mongoose.models.DistanceInterval as Model<DistanceInterval>) ??
  mongoose.model<DistanceInterval>('DistanceInterval', DistanceIntervalSchema);

// --- heart rate ----------------------------------------------------------

/**
 * Point samples, potentially >1000 per delivery — ingested with a single
 * bulkWrite of upserts keyed on the sample time.
 */
const HeartRateSampleSchema = new Schema(
  {
    time: { type: Date, required: true, unique: true },
    bpm: { type: Number, required: true },
    metadata: { type: MetadataSchema },
  },
  { collection: 'heart_rate_samples' },
);

export type HeartRateSample = InferSchemaType<typeof HeartRateSampleSchema>;
export const HeartRateSampleModel: Model<HeartRateSample> =
  (mongoose.models.HeartRateSample as Model<HeartRateSample>) ??
  mongoose.model<HeartRateSample>('HeartRateSample', HeartRateSampleSchema);

// --- exercise ------------------------------------------------------------

const ExerciseSessionSchema = new Schema(
  {
    startTime: { type: Date, required: true, unique: true },
    endTime: { type: Date, required: true },
    durationSeconds: { type: Number, required: true },
    typeCode: { type: String, required: true }, // raw value, e.g. "8"
    typeName: { type: String, required: true }, // mapped, e.g. "BIKING"
    // Optional linked data (present when the app has those types enabled)
    distanceMeters: { type: Number },
    steps: { type: Number },
    avgCadenceSpm: { type: Number },
    maxCadenceSpm: { type: Number },
    strideLengthM: { type: Number },
    metadata: { type: MetadataSchema },
    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, collection: 'exercise_sessions' },
);

ExerciseSessionSchema.index({ typeName: 1, startTime: -1 });

export type ExerciseSession = InferSchemaType<typeof ExerciseSessionSchema>;
export const ExerciseSessionModel: Model<ExerciseSession> =
  (mongoose.models.ExerciseSession as Model<ExerciseSession>) ??
  mongoose.model<ExerciseSession>('ExerciseSession', ExerciseSessionSchema);
