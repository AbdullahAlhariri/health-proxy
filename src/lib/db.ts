import mongoose from 'mongoose';

const MONGODB_URI =
  process.env.MONGODB_URI ?? 'mongodb://localhost:27017/healthdata';

/**
 * Cache the connection promise on globalThis so Astro's dev-mode HMR
 * (and serverless-style re-imports) never open duplicate connections.
 */
declare global {
  // eslint-disable-next-line no-var
  var __mongoose: Promise<typeof mongoose> | undefined;
}

export function connectDb(): Promise<typeof mongoose> {
  if (!globalThis.__mongoose) {
    globalThis.__mongoose = mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    globalThis.__mongoose.catch(() => {
      // Reset so the next request can retry instead of caching a rejection.
      globalThis.__mongoose = undefined;
    });
  }
  return globalThis.__mongoose;
}
