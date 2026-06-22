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

function createAccessoryMock(sensor: SensorConfig) {
  const accessoryInfoService = createFakeService();
  const tempSensorService = createFakeService();
  return {
    displayName: sensor.name,
    UUID: `uuid:switchbot-di-${sensor.deviceId}`,
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

  function buildAccessory(sensor = VALID_SENSOR) {
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

    const handler = new DiscomfortIndexAccessory(
      platform,
      accessory as unknown as Parameters<typeof DiscomfortIndexAccessory>[1],
      'token',
      'secret',
    );

    const getHandler = accessory._tempSensorService.characteristic._getHandler;

    return { handler, getHandler, log };
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

  it('exposes the DI multiplied by scale when enableScale is true', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 25, humidity: 60 } }),
      }),
    );

    // 25°C / 60% → DI 72.82; scaled ×2 → 145.6 (rounded to 0.1)
    const scaledSensor: SensorConfig = { name: 'Scaled', deviceId: 'AABBCCDDEEFF', enableScale: true, scale: 2 };
    const { handler, getHandler } = buildAccessory(scaledSensor);

    await handler.start();

    expect(getHandler!() as number).toBeCloseTo(145.6, 1);

    handler.stop();
  });

  it('clamps the scaled value to HomeKit\'s 150 maximum', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 25, humidity: 60 } }),
      }),
    );

    // 25°C / 60% → DI 72.82; ×10 = 728.2, which is clamped down to the 150 cap
    const sensor: SensorConfig = { name: 'Clamped', deviceId: 'AABBCCDDEEFF', enableScale: true, scale: 10 };
    const { handler, getHandler } = buildAccessory(sensor);

    await handler.start();

    expect(getHandler!() as number).toBe(150);

    handler.stop();
  });

  it('exposes the raw DI when enableScale is false or omitted (backward compatible)', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ statusCode: 100, message: 'success', body: { temperature: 25, humidity: 60 } }),
      }),
    );

    // scale is ignored because enableScale is not enabled
    const sensor: SensorConfig = { name: 'Unscaled', deviceId: 'AABBCCDDEEFF', scale: 2 };
    const { handler, getHandler } = buildAccessory(sensor);

    await handler.start();

    expect(getHandler!() as number).toBeCloseTo(72.8, 1);

    handler.stop();
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
