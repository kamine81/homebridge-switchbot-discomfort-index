import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HapStatusError, HAPStatus } from '@homebridge/hap-nodejs';
import type { Logger } from 'homebridge';

import { DiscomfortIndexAccessory } from './platformAccessory';
import type { SensorConfig } from './platformAccessory';

interface FakeService {
  setCharacteristic: (...args: unknown[]) => FakeService;
  getCharacteristic: (...args: unknown[]) => FakeCharacteristic;
  updateCharacteristic: (...args: unknown[]) => FakeService;
}

interface FakeCharacteristic {
  onGet: (cb: () => unknown) => FakeCharacteristic;
  setProps: (props: unknown) => FakeCharacteristic;
  _getHandler?: () => unknown;
}

function createFakeService(): FakeService & { characteristic: FakeCharacteristic } {
  const characteristic: FakeCharacteristic = {
    onGet: vi.fn().mockImplementation(function (this: FakeCharacteristic, cb: () => unknown) {
      this._getHandler = cb;
      return this;
    }),
    setProps: vi.fn().mockReturnThis(),
  };
  const service: FakeService & { characteristic: FakeCharacteristic } = {
    characteristic,
    setCharacteristic: vi.fn(() => service),
    getCharacteristic: vi.fn(() => characteristic),
    updateCharacteristic: vi.fn(() => service),
  };
  return service;
}

const VALID_SENSOR: SensorConfig = {
  name: 'Living Room',
  deviceId: 'AABBCCDDEEFF',
};

function createPlatformMock(log: Logger) {
  const Service = {
    AccessoryInformation: 'AccessoryInformation',
    TemperatureSensor: 'TemperatureSensor',
  };
  const Characteristic = {
    Manufacturer: 'Manufacturer',
    Model: 'Model',
    FirmwareRevision: 'FirmwareRevision',
    SerialNumber: 'SerialNumber',
    Name: 'Name',
    CurrentTemperature: 'CurrentTemperature',
  };
  return {
    log,
    Service,
    Characteristic,
    api: {
      hap: {
        HapStatusError,
        HAPStatus,
      },
    },
  };
}

function createAccessoryMock(sensor: SensorConfig, uuidPrefix = 'switchbot-di-') {
  const accessoryInfoService = createFakeService();
  const tempSensorService = createFakeService();
  return {
    displayName: sensor.name,
    UUID: `uuid:${uuidPrefix}${sensor.deviceId}`,
    context: { sensor },
    getService: vi.fn((key: unknown) => {
      if (key === 'AccessoryInformation') return accessoryInfoService;
      return tempSensorService;
    }),
    addService: vi.fn(() => tempSensorService),
    on: vi.fn(),
    _tempSensorService: tempSensorService,
  };
}

describe('DiscomfortIndexAccessory constructor', () => {
  it('throws when context.sensor fails isSensorConfig validation', () => {
    const log: Logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn(), success: vi.fn(),
    } as unknown as Logger;
    const platform = createPlatformMock(log) as unknown as Parameters<typeof DiscomfortIndexAccessory>[0];

    const invalidAccessory = {
      displayName: 'Test',
      UUID: 'test-uuid',
      context: { sensor: { deviceId: 'AABBCCDDEEFF' } }, // missing name
      getService: vi.fn(() => createFakeService()),
      addService: vi.fn(() => createFakeService()),
      on: vi.fn(),
    };

    expect(() => new DiscomfortIndexAccessory(
      platform,
      invalidAccessory as unknown as Parameters<typeof DiscomfortIndexAccessory>[1],
      'token',
      'secret',
    )).toThrow('Invalid or missing sensor config in accessory context');
  });
});

describe('DiscomfortIndexAccessory.handleGet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('test - fetch suppressed')));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function buildAccessory(sensor = VALID_SENSOR, withScaled = false) {
    const log: Logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
    } as unknown as Logger;

    const platform = createPlatformMock(log) as unknown as Parameters<typeof DiscomfortIndexAccessory>[0];
    const accessory = createAccessoryMock(sensor);
    const scaledAccessory = withScaled ? createAccessoryMock(sensor, 'switchbot-di-scaled-') : undefined;

    const handler = new DiscomfortIndexAccessory(
      platform,
      accessory as unknown as Parameters<typeof DiscomfortIndexAccessory>[1],
      'token',
      'secret',
      scaledAccessory as unknown as Parameters<typeof DiscomfortIndexAccessory>[4],
    );

    // getHandler returns the base accessory's value; scaledGet returns the scaled accessory's value.
    const getHandler = accessory._tempSensorService.characteristic._getHandler;
    const scaledGet = scaledAccessory?._tempSensorService.characteristic._getHandler;

    return { handler, getHandler, scaledGet, log };
  }

  it('throws HapStatusError (SERVICE_COMMUNICATION_FAILURE) before first successful refresh', () => {
    const { getHandler } = buildAccessory();
    expect(getHandler).toBeDefined();
    expect(() => getHandler!()).toThrow(HapStatusError);
    expect(() => getHandler!()).toThrow(
      expect.objectContaining({ hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE }),
    );
  });

  it('returns a DI value after the first refresh succeeds', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 25, humidity: 60 } }),
      }),
    );

    const { handler, getHandler } = buildAccessory();

    await handler.start();

    const result = getHandler!();
    expect(typeof result).toBe('number');
    expect(result as number).toBeGreaterThan(0);

    handler.stop();
  });

  it('exposes raw DI on the base and (DI - offset) * scale on the scaled accessory from one fetch', async () => {
    vi.unstubAllGlobals();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 25, humidity: 60 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // 25°C / 60% → DI 72.82; base = 72.8, scaled (72.82 - 0) × 2 → 145.6 (rounded to 0.1)
    const scaledSensor: SensorConfig = { name: 'Scaled', deviceId: 'AABBCCDDEEFF', scale: 2 };
    const { handler, getHandler, scaledGet } = buildAccessory(scaledSensor, true);

    await handler.start();

    expect(getHandler!() as number).toBeCloseTo(72.8, 1);
    expect(scaledGet!() as number).toBeCloseTo(145.6, 1);
    // A single device poll feeds both accessories.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    handler.stop();
  });

  it('applies the offset before scaling on the scaled accessory', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 25, humidity: 60 } }),
      }),
    );

    // 25°C / 60% → DI 72.82; (72.82 - 70) × 10 → 28.2 (rounded to 0.1)
    const scaledSensor: SensorConfig = { name: 'Scaled', deviceId: 'AABBCCDDEEFF', scale: 10, offset: 70 };
    const { handler, scaledGet } = buildAccessory(scaledSensor, true);

    await handler.start();

    expect(scaledGet!() as number).toBeCloseTo(28.2, 1);

    handler.stop();
  });

  it('clamps the scaled value to HomeKit\'s 750 maximum', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 40, humidity: 100 } }),
      }),
    );

    // 40°C / 100% → DI ≈ 104; × 10 = 1040, which is clamped down to the 750 cap
    const sensor: SensorConfig = { name: 'Clamped', deviceId: 'AABBCCDDEEFF', scale: 10 };
    const { handler, scaledGet, log } = buildAccessory(sensor, true);

    await handler.start();

    expect(scaledGet!() as number).toBe(750);
    // The clamp is surfaced as a warning so a misconfiguration is not silently swallowed.
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('clamped to 750'));
    // The debug line shows the pre-clamp value (1040), not the clamped 750, so the raw computation
    // stays visible for diagnosis.
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('= 1040 → clamped 750'));

    handler.stop();
  });

  it('warns once per clamping episode and re-arms after the value returns in range', async () => {
    vi.unstubAllGlobals();
    const clamped = {
      ok: true,
      json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 40, humidity: 100 } }),
    };
    const inRange = {
      ok: true,
      json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 22, humidity: 50 } }),
    };
    // start() → clamped, tick → still clamped, tick → in range, tick → clamped again.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(clamped)
      .mockResolvedValueOnce(clamped)
      .mockResolvedValueOnce(inRange)
      .mockResolvedValueOnce(clamped);
    vi.stubGlobal('fetch', fetchMock);

    const sensor: SensorConfig = { name: 'Episode', deviceId: 'AABBCCDDEEFF', scale: 10 };
    const { handler, log } = buildAccessory(sensor, true);

    await handler.start();                       // 1st clamp → 1 warn
    expect(log.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);   // still clamped → suppressed
    expect(log.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);   // back in range → reset, no warn
    expect(log.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);   // clamped again → new episode → 2nd warn
    expect(log.warn).toHaveBeenCalledTimes(2);

    handler.stop();
  });

  it('clamps the scaled value to HomeKit\'s -50 minimum', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 20, humidity: 50 } }),
      }),
    );

    // 20°C / 50% → DI ≈ 65.25; (65.25 - 150) × 1 ≈ -84.75, which is clamped up to the -50 floor
    const sensor: SensorConfig = { name: 'Floored', deviceId: 'AABBCCDDEEFF', scale: 1, offset: 150 };
    const { handler, scaledGet, log } = buildAccessory(sensor, true);

    await handler.start();

    expect(scaledGet!() as number).toBe(-50);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('clamped to -50'));

    handler.stop();
  });

  it('exposes the raw DI on the base variant regardless of scale/offset (backward compatible)', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 25, humidity: 60 } }),
      }),
    );

    // scale/offset are ignored because this is the base (non-scaled) accessory
    const sensor: SensorConfig = { name: 'Unscaled', deviceId: 'AABBCCDDEEFF', scale: 2, offset: 70 };
    const { handler, getHandler } = buildAccessory(sensor);

    await handler.start();

    expect(getHandler!() as number).toBeCloseTo(72.8, 1);

    handler.stop();
  });

  it('forwards out-of-range scale/offset warnings to log.warn when building the scaled accessory', () => {
    // Construction alone resolves scale/offset; no fetch/start needed to surface the warnings.
    const sensor: SensorConfig = { name: 'Bad', deviceId: 'AABBCCDDEEFF', scale: 20, offset: 200 };
    const { log } = buildAccessory(sensor, true);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('maximum'));
    // Both resolvers report independently (scale clamped to 10, offset clamped to 150).
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('logs a warn and starts with 60s default when updateInterval is NaN', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 25, humidity: 60 } }),
      }),
    );

    const nanSensor: SensorConfig = { name: 'Test', deviceId: 'AABBCCDDEEFF', updateInterval: NaN };
    const { handler, log } = buildAccessory(nanSensor);

    await handler.start();

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid updateInterval value'));

    handler.stop();
  });

  it('continues to throw HapStatusError after a failed fetch (does not return 0)', async () => {
    const { handler, getHandler } = buildAccessory();

    await handler.start();

    expect(() => getHandler!()).toThrow(HapStatusError);
    expect(() => getHandler!()).toThrow(
      expect.objectContaining({ hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE }),
    );

    handler.stop();
  });

  it('throws HapStatusError when temperature/humidity is non-finite after refresh', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statusCode: 100, message: 'success', body: {} }),
      }),
    );

    const { handler, getHandler } = buildAccessory();

    await handler.start();

    expect(() => getHandler!()).toThrow(HapStatusError);

    handler.stop();
  });

  it('logs an error and leaves ready=false when the API returns malformed JSON', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      }),
    );

    const { handler, getHandler, log } = buildAccessory();

    await handler.start();

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse SwitchBot API response as JSON'),
    );
    expect(() => getHandler!()).toThrow(HapStatusError);

    handler.stop();
  });
});
