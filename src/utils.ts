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
}

export function isSensorConfig(v: unknown): v is SensorConfig {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.name === 'string' && obj.name.length > 0 &&
    typeof obj.deviceId === 'string' && obj.deviceId.length > 0 &&
    (obj.updateInterval === undefined || typeof obj.updateInterval === 'number')
  );
}

const MIN_INTERVAL = 30;
const MAX_INTERVAL = 3600;
const DEFAULT_INTERVAL = 60;

export function resolveUpdateInterval(raw: unknown): { value: number; warning?: string } {
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
