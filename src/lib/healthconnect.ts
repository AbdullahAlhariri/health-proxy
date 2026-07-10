import { Schema } from 'mongoose';

/**
 * Health Connect numeric constants → readable names.
 *
 * Real HC Webhook payloads deliver these as numeric strings ("4", "8"),
 * not enum names. Mappings follow AndroidX Health Connect:
 * SleepSessionRecord.STAGE_TYPE_* and ExerciseSessionRecord.EXERCISE_TYPE_*.
 */

export const SLEEP_STAGE_NAMES: Record<string, string> = {
  '0': 'UNKNOWN',
  '1': 'AWAKE',
  '2': 'SLEEPING',
  '3': 'OUT_OF_BED',
  '4': 'LIGHT',
  '5': 'DEEP',
  '6': 'REM',
  '7': 'AWAKE_IN_BED',
};

export function sleepStageName(code: string): string {
  // Tolerate both numeric codes and already-named values.
  return SLEEP_STAGE_NAMES[code] ?? code.toUpperCase();
}

// Common subset of ExerciseSessionRecord.EXERCISE_TYPE_* constants.
// Unknown codes fall back to `TYPE_<code>` so nothing is lost.
export const EXERCISE_TYPE_NAMES: Record<string, string> = {
  '2': 'BADMINTON',
  '5': 'BASKETBALL',
  '8': 'BIKING',
  '9': 'BIKING_STATIONARY',
  '13': 'CALISTHENICS',
  '25': 'ELLIPTICAL',
  '29': 'FOOTBALL_AUSTRALIAN',
  '32': 'GOLF',
  '36': 'HIGH_INTENSITY_INTERVAL_TRAINING',
  '37': 'HIKING',
  '53': 'ROWING',
  '54': 'ROWING_MACHINE',
  '56': 'RUNNING',
  '57': 'RUNNING_TREADMILL',
  '64': 'SOCCER',
  '70': 'STRENGTH_TRAINING',
  '71': 'STRETCHING',
  '73': 'SWIMMING_OPEN_WATER',
  '74': 'SWIMMING_POOL',
  '76': 'TENNIS',
  '79': 'WALKING',
  '81': 'WEIGHTLIFTING',
  '83': 'YOGA',
};

export function exerciseTypeName(code: string): string {
  if (EXERCISE_TYPE_NAMES[code]) return EXERCISE_TYPE_NAMES[code];
  return /^\d+$/.test(code) ? `TYPE_${code}` : code.toUpperCase();
}

/**
 * Record metadata as delivered by HC Webhook (present on real payloads,
 * undocumented in the spec): data origin package, recording method, device.
 */
export const MetadataSchema = new Schema(
  {
    dataOrigin: { type: String },
    recordingMethod: { type: String },
    device: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

export function mapMetadata(m: any) {
  if (!m) return undefined;
  return {
    dataOrigin: m.data_origin,
    recordingMethod: m.recording_method,
    device: m.device,
  };
}
