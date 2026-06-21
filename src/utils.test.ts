import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';

import {
  buildSwitchBotAuthHeaders,
  calculateDiscomfortIndex,
  isSensorConfig,
  isValidDeviceId,
  isValidToken,
  resolveScale,
  resolveUpdateInterval,
} from './utils';

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
  it('returns default 1 with no warning when value is undefined (not configured)', () => {
    expect(resolveScale(undefined)).toEqual({ value: 1 });
  });

  it('passes through valid values within range without warning', () => {
    expect(resolveScale(1)).toEqual({ value: 1 });
    expect(resolveScale(2)).toEqual({ value: 2 });
    expect(resolveScale(2.5)).toEqual({ value: 2.5 });
    expect(resolveScale(10)).toEqual({ value: 10 });
  });

  it('returns default 1 with a warning for non-finite values (NaN, Infinity, string, null)', () => {
    expect(resolveScale(NaN)).toMatchObject({ value: 1, warning: expect.stringContaining('Invalid') });
    expect(resolveScale(Infinity)).toMatchObject({ value: 1, warning: expect.any(String) });
    expect(resolveScale('2')).toMatchObject({ value: 1, warning: expect.any(String) });
    expect(resolveScale(null)).toMatchObject({ value: 1, warning: expect.any(String) });
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

  it('returns true when enableScale and scale are valid', () => {
    expect(isSensorConfig({ name: 'Room', deviceId: 'AABBCCDDEEFF', enableScale: true, scale: 2 })).toBe(true);
    expect(isSensorConfig({ name: 'Room', deviceId: 'AABBCCDDEEFF', enableScale: false })).toBe(true);
  });

  it('returns false when scale is a string', () => {
    expect(isSensorConfig({ name: 'Room', deviceId: 'AABBCCDDEEFF', scale: '2' })).toBe(false);
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
