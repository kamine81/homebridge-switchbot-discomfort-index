import { createHmac } from 'crypto';

// A SwitchBot deviceId is a 12-digit hex string derived from the BLE MAC address (e.g. C271111EC0AB)
// https://github.com/OpenWonderLabs/SwitchBotAPI
const DEVICE_ID_PATTERN = /^[A-F0-9]{12}$/i;

export function isValidDeviceId(deviceId: string): boolean {
  return DEVICE_ID_PATTERN.test(deviceId);
}

export function isValidToken(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export interface SensorConfig {
  name: string;
  deviceId: string;
  updateInterval?: number;
  enableScale?: boolean;
  scale?: number;
  offset?: number;
}

export function isSensorConfig(v: unknown): v is SensorConfig {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.name === 'string' && obj.name.length > 0 &&
    typeof obj.deviceId === 'string' && obj.deviceId.length > 0 &&
    (obj.updateInterval === undefined || typeof obj.updateInterval === 'number') &&
    (obj.enableScale === undefined || typeof obj.enableScale === 'boolean') &&
    (obj.scale === undefined || typeof obj.scale === 'number') &&
    (obj.offset === undefined || typeof obj.offset === 'number')
  );
}

// The result of resolving a numeric config field: the value to use, plus an optional operator-facing
// warning when the raw input was invalid, out of range, or otherwise adjusted.
export interface ResolvedValue {
  value: number;
  warning?: string;
}

const MIN_INTERVAL = 30;
const MAX_INTERVAL = 3600;
const DEFAULT_INTERVAL = 60;

export function resolveUpdateInterval(raw: unknown): ResolvedValue {
  if (raw === undefined) return { value: DEFAULT_INTERVAL };

  if (!Number.isFinite(raw)) {
    return {
      value: DEFAULT_INTERVAL,
      warning: `Invalid updateInterval value (${String(raw)}). Using default of ${DEFAULT_INTERVAL} seconds.`,
    };
  }

  const num = raw as number;
  const rounded = Number.isInteger(num) ? num : Math.round(num);
  const clamped = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, rounded));

  if (num === clamped) return { value: clamped };

  const parts: string[] = [];
  if (!Number.isInteger(num)) parts.push(`rounded from ${num} to ${rounded}`);
  if (clamped !== rounded) parts.push(`clamped to ${clamped === MIN_INTERVAL ? 'minimum' : 'maximum'} ${clamped}`);

  return { value: clamped, warning: `updateInterval ${parts.join(', ')}.` };
}

// Keep these in sync with the `scale` field in config.schema.json (minimum/maximum/default).
// utils.test.ts asserts they match the schema to catch drift.
const MIN_SCALE = 1;
const MAX_SCALE = 10;
const DEFAULT_SCALE = 2;

// Resolves the scale factor used by the optional scaled accessory, which exposes
// (DI - offset) * scale. Scaling lets HomeKit automation thresholds (which only step in increments
// of 0.5) target a finer DI granularity (e.g. scale=10 makes one 0.5-step equal 0.05 DI). The scale
// may be fractional, so unlike resolveUpdateInterval it is not rounded to an integer.
export function resolveScale(raw: unknown): ResolvedValue {
  if (raw === undefined) return { value: DEFAULT_SCALE };

  if (!Number.isFinite(raw)) {
    return {
      value: DEFAULT_SCALE,
      warning: `Invalid scale value (${String(raw)}). Using default of ${DEFAULT_SCALE}.`,
    };
  }

  const num = raw as number;
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, num));

  if (num === clamped) return { value: clamped };

  return {
    value: clamped,
    warning: `scale clamped to ${clamped === MIN_SCALE ? 'minimum' : 'maximum'} ${clamped} (was ${num}).`,
  };
}

// Keep these in sync with the `offset` field in config.schema.json (minimum/maximum/default).
// utils.test.ts asserts they match the schema to catch drift.
const MIN_OFFSET = 0;
const MAX_OFFSET = 150;
const DEFAULT_OFFSET = 0;

// Resolves the offset subtracted from the Discomfort Index before scaling on the scaled accessory.
// It lets the DI band of interest be shifted toward 0 so the scaled value fits within HomeKit's 750
// trigger cap (e.g. offset=60, scale=10 maps DI 60->0 and DI 75->150). May be fractional.
export function resolveOffset(raw: unknown): ResolvedValue {
  if (raw === undefined) return { value: DEFAULT_OFFSET };

  if (!Number.isFinite(raw)) {
    return {
      value: DEFAULT_OFFSET,
      warning: `Invalid offset value (${String(raw)}). Using default of ${DEFAULT_OFFSET}.`,
    };
  }

  const num = raw as number;
  const clamped = Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, num));

  if (num === clamped) return { value: clamped };

  return {
    value: clamped,
    warning: `offset clamped to ${clamped === MIN_OFFSET ? 'minimum' : 'maximum'} ${clamped} (was ${num}).`,
  };
}

export function calculateDiscomfortIndex(temperature: number, humidity: number): number {
  return 0.81 * temperature + 0.01 * humidity * (0.99 * temperature - 14.3) + 46.3;
}

export interface SwitchBotAuthHeaders {
  sign: string;
  t: string;
  nonce: string;
}

// The returned sign and Authorization values are secrets. Never embed them in logs or error messages.
export function buildSwitchBotAuthHeaders(
  token: string,
  secret: string,
  t: string,
  nonce: string,
): SwitchBotAuthHeaders {
  const sign = createHmac('sha256', secret)
    .update(token + t + nonce)
    .digest('base64');
  return { sign, t, nonce };
}
