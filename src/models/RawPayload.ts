import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Verbatim archive of every webhook delivery. Cheap insurance:
 * if the ingest logic ever mis-parses something, the original
 * JSON is still here to replay. Capped by a TTL index (90 days).
 */
const RawPayloadSchema = new Schema(
  {
    payloadTimestamp: { type: Date },
    appVersion: { type: String },
    dataTypes: { type: [String], default: [] }, // which arrays were present
    body: { type: Schema.Types.Mixed, required: true },
    receivedAt: { type: Date, default: () => new Date() },
  },
  { collection: 'raw_payloads' },
);

// Auto-expire raw archives after 90 days.
RawPayloadSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export type RawPayload = InferSchemaType<typeof RawPayloadSchema>;

export const RawPayloadModel: Model<RawPayload> =
  (mongoose.models.RawPayload as Model<RawPayload>) ??
  mongoose.model<RawPayload>('RawPayload', RawPayloadSchema);
