import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';

import {
  buildSwitchBotAuthHeaders,
  calculateDiscomfortIndex,
  isSensorConfig,
  isValidDeviceId,
  isValidToken,
  resolveOffset,
  resolveScale,
  resolveUpdateInterval,
} from './utils';
import schema from '../config.schema.json';

describe('isValidDeviceId', () => {
  it('accepts a 12-digit hex deviceId', () => {
    expect(isValidDeviceId('AABBCCDDEEFF')).toBe(true);
    expect(isValidDeviceId('aabbccddeeff')).toBe(true);
    expect(isValidDeviceId('C271111EC0AB')).toBe(true);
  });

  it('rejects non-12-digit or invalid-character IDs', () => {
    expect(isValidDeviceId('AABB')).toBe(false);
    expect(isValidDeviceId('AABBCCDDEEF')).toBe(false); // 11 digits
    expect(isValidDeviceId('AABBCCDDEEFFAA')).toBe(false); // 14 digits
    expect(isValidDeviceId('0123456789ABCDEF')).toBe(false); // 16 digits
    expect(isValidDeviceId('AABBCCDDEEFG')).toBe(false); // non-hex character
    expect(isValidDeviceId('../etc/passwd')).toBe(false);
    expect(isValidDeviceId('AA-BB-CC-DD-EE-FF')).toBe(false);
    expect(isValidDeviceId('')).toBe(false);
  });
});

describe('calculateDiscomfortIndex', () => {
  it('calculates according to the Thom formula', () => {
    // 25°C / 60% → 0.81*25 + 0.01*60*(0.99*25 - 14.3) + 46.3 = 72.82
    const di = calculateDiscomfortIndex(25, 60);
    expect(di).toBeCloseTo(72.82, 2);
  });

  it('distinguishes comfortable (DI<70) from uncomfortable (DI>75)', () => {
    expect(calculateDiscomfortIndex(20, 50)).toBeLessThan(70);
    expect(calculateDiscomfortIndex(30, 80)).toBeGreaterThan(75);
  });
});

describe('isValidToken', () => {
  it('accepts a non-empty string', () => {
    expect(isValidToken('abc')).toBe(true);
    expect(isValidToken('  a  ')).toBe(true);
  });

  it('rejects empty string, whitespace-only, and non-string values', () => {
    expect(isValidToken('')).toBe(false);
    expect(isValidToken('   ')).toBe(false);
    expect(isValidToken(undefined)).toBe(false);
    expect(isValidToken(null)).toBe(false);
    expect(isValidToken(123)).toBe(false);
  });
});

describe('resolveUpdateInterval', () => {
  it('returns default 60 with no warning when value is undefined (not configured)', () => {
    expect(resolveUpdateInterval(undefined)).toEqual({ value: 60 });
  });

  it('passes through a valid integer within range without warning', () => {
    expect(resolveUpdateInterval(60)).toEqual({ value: 60 });
    expect(resolveUpdateInterval(30)).toEqual({ value: 30 });
    expect(resolveUpdateInterval(3600)).toEqual({ value: 3600 });
  });

  it('returns default 60 with a warning for non-finite values (NaN, Infinity, string)', () => {
    expect(resolveUpdateInterval(NaN)).toMatchObject({ value: 60, warning: expect.stringContaining('Invalid') });
    expect(resolveUpdateInterval(Infinity)).toMatchObject({ value: 60, warning: expect.any(String) });
    expect(resolveUpdateInterval('60')).toMatchObject({ value: 60, warning: expect.any(String) });
    expect(resolveUpdateInterval(null)).toMatchObject({ value: 60, warning: expect.any(String) });
  });

  it('rounds a non-integer value and includes a warning', () => {
    const result = resolveUpdateInterval(45.5);
    expect(result.value).toBe(46);
    expect(result.warning).toMatch(/45\.5/);
  });

  it('clamps a value below 30 to 30 and includes a warning', () => {
    const result = resolveUpdateInterval(10);
    expect(result.value).toBe(30);
    expect(result.warning).toMatch(/minimum/);
  });

  it('clamps a value above 3600 to 3600 and includes a warning', () => {
    const result = resolveUpdateInterval(7200);
    expect(result.value).toBe(3600);
    expect(result.warning).toMatch(/maximum/);
  });

  it('rounds then clamps when a non-integer is also out of range', () => {
    const result = resolveUpdateInterval(15.5); // rounds to 16, clamps to 30
    expect(result.value).toBe(30);
    expect(result.warning).toMatch(/15\.5/);
  });
});

describe('resolveScale', () => {
  it('returns default 2 with no warning when value is undefined (not configured)', () => {
    expect(resolveScale(undefined)).toEqual({ value: 2 });
  });

  it('passes through valid values within range without warning', () => {
    expect(resolveScale(1)).toEqual({ value: 1 });
    expect(resolveScale(2)).toEqual({ value: 2 });
    expect(resolveScale(2.5)).toEqual({ value: 2.5 });
    expect(resolveScale(10)).toEqual({ value: 10 });
  });

  it('returns default 2 with a warning for non-finite values (NaN, Infinity, string, null)', () => {
    expect(resolveScale(NaN)).toMatchObject({ value: 2, warning: expect.stringContaining('Invalid') });
    expect(resolveScale(Infinity)).toMatchObject({ value: 2, warning: expect.any(String) });
    expect(resolveScale('2')).toMatchObject({ value: 2, warning: expect.any(String) });
    expect(resolveScale(null)).toMatchObject({ value: 2, warning: expect.any(String) });
  });

  it('clamps a value below 1 to 1 and includes a warning', () => {
    const result = resolveScale(0.5);
    expect(result.value).toBe(1);
    expect(result.warning).toMatch(/minimum/);
  });

  it('clamps a value above 10 to 10 and includes a warning', () => {
    const result = resolveScale(20);
    expect(result.value).toBe(10);
    expect(result.warning).toMatch(/maximum/);
  });
});

describe('resolveOffset', () => {
  it('returns default 0 with no warning when value is undefined (not configured)', () => {
    expect(resolveOffset(undefined)).toEqual({ value: 0 });
  });

  it('passes through valid values within range without warning', () => {
    expect(resolveOffset(0)).toEqual({ value: 0 });
    expect(resolveOffset(60)).toEqual({ value: 60 });
    expect(resolveOffset(72.5)).toEqual({ value: 72.5 });
    expect(resolveOffset(150)).toEqual({ value: 150 });
  });

  it('returns default 0 with a warning for non-finite values (NaN, Infinity, string, null)', () => {
    expect(resolveOffset(NaN)).toMatchObject({ value: 0, warning: expect.stringContaining('Invalid') });
    expect(resolveOffset(Infinity)).toMatchObject({ value: 0, warning: expect.any(String) });
    expect(resolveOffset('60')).toMatchObject({ value: 0, warning: expect.any(String) });
    expect(resolveOffset(null)).toMatchObject({ value: 0, warning: expect.any(String) });
  });

  it('clamps a value below 0 to 0 and includes a warning', () => {
    const result = resolveOffset(-10);
    expect(result.value).toBe(0);
    expect(result.warning).toMatch(/minimum/);
  });

  it('clamps a value above 150 to 150 and includes a warning', () => {
    const result = resolveOffset(200);
    expect(result.value).toBe(150);
    expect(result.warning).toMatch(/maximum/);
  });
});

// The numeric bounds live both in utils.ts (the runtime clamps) and config.schema.json (the
// Homebridge UI form). These tests pin the resolver behaviour to the schema so the two cannot drift.
describe('scale/offset bounds stay in sync with config.schema.json', () => {
  const props = schema.schema.properties.sensors.items.properties;

  it('declares scale/offset as numeric fields in the schema', () => {
    // The resolvers coerce with Number.isFinite; a schema type change would silently break that contract.
    expect(props.scale.type).toBe('number');
    expect(props.offset.type).toBe('number');
  });

  it('resolveScale matches the schema default/minimum/maximum', () => {
    const { default: def, minimum, maximum } = props.scale;
    expect(resolveScale(undefined).value).toBe(def);
    expect(resolveScale(minimum - 1).value).toBe(minimum);
    expect(resolveScale(maximum + 1).value).toBe(maximum);
  });

  it('resolveOffset matches the schema default/minimum/maximum', () => {
    const { default: def, minimum, maximum } = props.offset;
    expect(resolveOffset(undefined).value).toBe(def);
    expect(resolveOffset(minimum - 1).value).toBe(minimum);
    expect(resolveOffset(maximum + 1).value).toBe(maximum);
  });
});

describe('buildSwitchBotAuthHeaders', () => {
  it('produces a valid HMAC-SHA256/base64 signature per SwitchBot v1.1 spec', () => {
    const token = 'test-token';
    const secret = 'test-secret';
    const t = '1700000000000';
    const nonce = 'fixed-nonce';

    const expected = createHmac('sha256', secret)
      .update(token + t + nonce)
      .digest('base64');

    const headers = buildSwitchBotAuthHeaders(token, secret, t, nonce);
    expect(headers.sign).toBe(expected);
    expect(headers.t).toBe(t);
    expect(headers.nonce).toBe(nonce);
  });

  it('produces a different signature when the secret differs', () => {
    const a = buildSwitchBotAuthHeaders('tok', 'secret-a', '1', 'n');
    const b = buildSwitchBotAuthHeaders('tok', 'secret-b', '1', 'n');
    expect(a.sign).not.toBe(b.sign);
  });
});

describe('isSensorConfig', () => {
  it('returns true for a valid config without updateInterval', () => {
    expect(isSensorConfig({ name: 'Living Room', deviceId: 'AABBCCDDEEFF' })).toBe(true);
  });

  it('returns true when updateInterval is a number', () => {
    expect(isSensorConfig({ name: 'Room', deviceId: 'AABBCCDDEEFF', updateInterval: 60 })).toBe(true);
  });

  it('returns false when name is missing', () => {
    expect(isSensorConfig({ deviceId: 'AABBCCDDEEFF' })).toBe(false);
  });

  it('returns false when name is an empty string', () => {
    expect(isSensorConfig({ name: '', deviceId: 'AABBCCDDEEFF' })).toBe(false);
  });

  it('returns false when deviceId is missing', () => {
    expect(isSensorConfig({ name: 'Room' })).toBe(false);
  });

  it('returns false when updateInterval is a string', () => {
    expect(isSensorConfig({ name: 'Room', deviceId: 'AABBCCDDEEFF', updateInterval: '60' })).toBe(false);
  });

  it('returns true when enableScale, scale and offset are valid', () => {
    expect(isSensorConfig({ name: 'Room', deviceId: 'AABBCCDDEEFF', enableScale: true, scale: 2, offset: 60 })).toBe(true);
    expect(isSensorConfig({ name: 'Room', deviceId: 'AABBCCDDEEFF', enableScale: false })).toBe(true);
  });

  it('returns false when scale is a string', () => {
    expect(isSensorConfig({ name: 'Room', deviceId: 'AABBCCDDEEFF', scale: '2' })).toBe(false);
  });

  it('returns false when offset is a string', () => {
    expect(isSensorConfig({ name: 'Room', deviceId: 'AABBCCDDEEFF', offset: '60' })).toBe(false);
  });

  it('returns false when enableScale is a string', () => {
    expect(isSensorConfig({ name: 'Room', deviceId: 'AABBCCDDEEFF', enableScale: 'true' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSensorConfig(null)).toBe(false);
  });

  it('returns false for a non-object', () => {
    expect(isSensorConfig('string')).toBe(false);
  });
});
