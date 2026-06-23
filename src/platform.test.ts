import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';

import { SwitchBotDiscomfortIndexPlatform } from './platform';
import { DiscomfortIndexAccessory } from './platformAccessory';
import type { SensorConfig } from './platformAccessory';

interface FakeService {
  setCharacteristic: (...args: unknown[]) => FakeService;
  getCharacteristic: (...args: unknown[]) => {
    onGet: (cb: unknown) => unknown;
    setProps: (props: unknown) => unknown;
  };
  updateCharacteristic: (...args: unknown[]) => FakeService;
}

function createFakeService(): FakeService {
  const characteristic = {
    onGet: vi.fn().mockReturnThis(),
    setProps: vi.fn().mockReturnThis(),
  };
  const service: FakeService = {
    setCharacteristic: vi.fn(() => service),
    getCharacteristic: vi.fn(() => characteristic),
    updateCharacteristic: vi.fn(() => service),
  };
  return service;
}

interface FakePlatformAccessory {
  displayName: string;
  UUID: string;
  context: { sensor?: SensorConfig };
  getService: (...args: unknown[]) => FakeService;
  addService: (...args: unknown[]) => FakeService;
  on: (event: string, cb: () => void) => void;
}

interface FakeApiHarness {
  api: API;
  log: Logger;
  registerPlatformAccessories: ReturnType<typeof vi.fn>;
  unregisterPlatformAccessories: ReturnType<typeof vi.fn>;
  triggerLaunch: () => void;
  triggerShutdown: () => void;
}

function createHarness(): FakeApiHarness {
  const Service = {
    AccessoryInformation: 'AccessoryInformation',
    TemperatureSensor: 'TemperatureSensor',
  };
  const Characteristic = {
    Manufacturer: 'Manufacturer',
    Model: 'Model',
    SerialNumber: 'SerialNumber',
    Name: 'Name',
    CurrentTemperature: 'CurrentTemperature',
  };

  const eventHandlers = new Map<string, Array<() => void>>();

  const platformAccessoryCtor = function (this: FakePlatformAccessory, name: string, uuid: string) {
    this.displayName = name;
    this.UUID = uuid;
    this.context = {};
    const accessoryInfoService = createFakeService();
    const tempSensorService = createFakeService();
    this.getService = vi.fn((key: unknown) => {
      if (key === Service.AccessoryInformation) return accessoryInfoService;
      if (key === Service.TemperatureSensor) return tempSensorService;
      return tempSensorService;
    }) as unknown as FakePlatformAccessory['getService'];
    this.addService = vi.fn(() => tempSensorService) as unknown as FakePlatformAccessory['addService'];
    this.on = vi.fn();
  } as unknown as new (name: string, uuid: string) => PlatformAccessory;

  const registerPlatformAccessories = vi.fn();
  const unregisterPlatformAccessories = vi.fn();

  const api = {
    hap: {
      Service,
      Characteristic,
      uuid: {
        generate: (input: string) => `uuid:${input}`,
      },
    },
    platformAccessory: platformAccessoryCtor,
    registerPlatformAccessories,
    unregisterPlatformAccessories,
    on: (event: string, cb: () => void) => {
      const list = eventHandlers.get(event) ?? [];
      list.push(cb);
      eventHandlers.set(event, list);
    },
  } as unknown as API;

  const log: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  } as unknown as Logger;

  return {
    api,
    log,
    registerPlatformAccessories,
    unregisterPlatformAccessories,
    triggerLaunch: () => {
      for (const cb of eventHandlers.get('didFinishLaunching') ?? []) cb();
    },
    triggerShutdown: () => {
      for (const cb of eventHandlers.get('shutdown') ?? []) cb();
    },
  };
}

const VALID_SENSOR_A: SensorConfig = {
  name: 'Living Room',
  deviceId: 'AABBCCDDEEFF',
};
const VALID_SENSOR_B: SensorConfig = {
  name: 'Bedroom',
  deviceId: '112233445566',
};

function makeConfig(sensors: SensorConfig[], override: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    platform: 'SwitchBotDiscomfortIndex',
    name: 'SwitchBotDiscomfortIndex',
    token: 'tok',
    secret: 'sec',
    sensors,
    ...override,
  };
}

function makeSuccessFetch(body: { temperature?: unknown; humidity?: unknown }) {
  return () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ statusCode: 100, message: 'success', body }),
    });
}

describe('SwitchBotDiscomfortIndexPlatform.discoverDevices', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('test - fetch suppressed')));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pushes a new accessory into the accessories array on first registration', () => {
    const harness = createHarness();
    const config: PlatformConfig = {
      platform: 'SwitchBotDiscomfortIndex',
      name: 'SwitchBotDiscomfortIndex',
      token: 'tok',
      secret: 'sec',
      sensors: [{ ...VALID_SENSOR_A }],
    };

    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();

    expect(platform.accessories).toHaveLength(1);
    expect(platform.accessories[0].displayName).toBe(VALID_SENSOR_A.name);
    expect(platform.accessories[0].UUID).toBe(`uuid:switchbot-di-${VALID_SENSOR_A.deviceId}`);
    expect(harness.registerPlatformAccessories).toHaveBeenCalledTimes(1);

    harness.triggerShutdown();
  });

  it('registers a second scaled accessory when enableScale is true', () => {
    const harness = createHarness();
    const config = makeConfig([{ ...VALID_SENSOR_A, enableScale: true, scale: 10, offset: 60 }]);

    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();

    expect(platform.accessories).toHaveLength(2);
    const uuids = platform.accessories.map(a => a.UUID);
    expect(uuids).toContain(`uuid:switchbot-di-${VALID_SENSOR_A.deviceId}`);
    expect(uuids).toContain(`uuid:switchbot-di-scaled-${VALID_SENSOR_A.deviceId}`);

    const scaled = platform.accessories.find(
      a => a.UUID === `uuid:switchbot-di-scaled-${VALID_SENSOR_A.deviceId}`,
    );
    expect(scaled!.displayName).toBe(`${VALID_SENSOR_A.name} Scaled`);
    expect(harness.registerPlatformAccessories).toHaveBeenCalledTimes(2);

    harness.triggerShutdown();
  });

  it.each([
    { label: 'both scale and offset', sensor: { scale: 10, offset: 60 } },
    { label: 'scale only', sensor: { scale: 10 } },
    { label: 'offset only', sensor: { offset: 60 } },
  ])('warns when $label is set but enableScale is not enabled', ({ sensor }) => {
    const harness = createHarness();
    const config = makeConfig([{ ...VALID_SENSOR_A, ...sensor }]);

    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();

    // Only the base accessory is registered; the orphaned scale/offset are reported, not silently ignored.
    expect(platform.accessories).toHaveLength(1);
    expect(harness.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('enableScale is not enabled'),
    );

    harness.triggerShutdown();
  });

  it('does not warn about ignored scale/offset when neither is set', () => {
    const harness = createHarness();
    const config = makeConfig([{ ...VALID_SENSOR_A }]);

    new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();

    expect(harness.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('enableScale is not enabled'),
    );

    harness.triggerShutdown();
  });

  it('adds the scaled accessory when enableScale is toggled on for an existing sensor', () => {
    const harness = createHarness();
    const sensor: SensorConfig = { ...VALID_SENSOR_A };
    const config = makeConfig([sensor]);

    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();
    expect(platform.accessories).toHaveLength(1);
    expect(harness.registerPlatformAccessories).toHaveBeenCalledTimes(1);

    // Enable scaling and re-run discovery: the base is reconfigured (not re-registered) while the
    // scaled accessory is registered new in the same pass.
    sensor.enableScale = true;
    sensor.scale = 10;
    harness.triggerLaunch();

    expect(platform.accessories).toHaveLength(2);
    expect(harness.registerPlatformAccessories).toHaveBeenCalledTimes(2);
    const secondRegistration = harness.registerPlatformAccessories.mock.calls[1][2] as PlatformAccessory[];
    expect(secondRegistration).toHaveLength(1);
    expect(secondRegistration[0].UUID).toBe(`uuid:switchbot-di-scaled-${VALID_SENSOR_A.deviceId}`);

    harness.triggerShutdown();
  });

  it('removes the scaled accessory when enableScale is toggled off', () => {
    const harness = createHarness();
    const sensor: SensorConfig = { ...VALID_SENSOR_A, enableScale: true, scale: 10, offset: 60 };
    const config = makeConfig([sensor]);

    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();
    expect(platform.accessories).toHaveLength(2);

    // Disable scaling and re-run discovery
    delete sensor.enableScale;
    harness.triggerLaunch();

    expect(harness.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
    const unregistered = harness.unregisterPlatformAccessories.mock.calls[0][2] as PlatformAccessory[];
    expect(unregistered).toHaveLength(1);
    expect(unregistered[0].UUID).toBe(`uuid:switchbot-di-scaled-${VALID_SENSOR_A.deviceId}`);

    harness.triggerShutdown();
  });

  it('marks a removed sensor as stale and unregisters it on the next discoverDevices call', () => {
    const harness = createHarness();
    const sensors: SensorConfig[] = [{ ...VALID_SENSOR_A }, { ...VALID_SENSOR_B }];
    const config: PlatformConfig = {
      platform: 'SwitchBotDiscomfortIndex',
      name: 'SwitchBotDiscomfortIndex',
      token: 'tok',
      secret: 'sec',
      sensors,
    };

    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();

    expect(platform.accessories).toHaveLength(2);
    expect(harness.registerPlatformAccessories).toHaveBeenCalledTimes(2);

    sensors.pop();

    harness.triggerLaunch();

    expect(harness.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
    const unregisteredArg = harness.unregisterPlatformAccessories.mock.calls[0][2] as PlatformAccessory[];
    expect(unregisteredArg).toHaveLength(1);
    expect(unregisteredArg[0].UUID).toBe(`uuid:switchbot-di-${VALID_SENSOR_B.deviceId}`);

    harness.triggerShutdown();
  });

  it('skips sensors with an invalid deviceId and registers only valid ones', () => {
    const harness = createHarness();
    const config: PlatformConfig = {
      platform: 'SwitchBotDiscomfortIndex',
      name: 'SwitchBotDiscomfortIndex',
      token: 'tok',
      secret: 'sec',
      sensors: [
        { name: 'Invalid', deviceId: 'INVALID' },
        { ...VALID_SENSOR_A },
      ],
    };

    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();

    expect(platform.accessories).toHaveLength(1);
    expect(platform.accessories[0].displayName).toBe(VALID_SENSOR_A.name);
    expect(harness.log.warn).toHaveBeenCalled();

    harness.triggerShutdown();
  });

  it('logs an error and registers no accessories when token is missing', () => {
    const harness = createHarness();
    const config = makeConfig([{ ...VALID_SENSOR_A }], { token: undefined });
    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();

    expect(harness.log.error).toHaveBeenCalled();
    expect(harness.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(platform.accessories).toHaveLength(0);
  });

  it('logs an error and registers no accessories when token is empty string', () => {
    const harness = createHarness();
    const config = makeConfig([{ ...VALID_SENSOR_A }], { token: '' });
    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();

    expect(harness.log.error).toHaveBeenCalled();
    expect(harness.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(platform.accessories).toHaveLength(0);
  });

  it('logs a warning when sensors array is empty', () => {
    const harness = createHarness();
    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, makeConfig([]), harness.api);
    harness.triggerLaunch();

    expect(harness.log.warn).toHaveBeenCalledWith(expect.stringContaining('No sensors configured'));
    expect(platform.accessories).toHaveLength(0);
  });

  it('skips sensors with no name and registers only valid ones', () => {
    const harness = createHarness();
    const config = makeConfig([
      { name: '', deviceId: 'AABBCCDDEEFF' },
      { ...VALID_SENSOR_B },
    ]);
    const platform = new SwitchBotDiscomfortIndexPlatform(harness.log, config, harness.api);
    harness.triggerLaunch();

    expect(platform.accessories).toHaveLength(1);
    expect(platform.accessories[0].displayName).toBe(VALID_SENSOR_B.name);
    expect(harness.log.warn).toHaveBeenCalled();

    harness.triggerShutdown();
  });
});

describe('SwitchBotDiscomfortIndexPlatform - handler management', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('staggers start() calls by 200ms per sensor to avoid API spikes', async () => {
    const harness = createHarness();
    let fetchCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        fetchCallCount++;
        return makeSuccessFetch({ temperature: 25, humidity: 60 })();
      }),
    );

    new SwitchBotDiscomfortIndexPlatform(
      harness.log,
      makeConfig([{ ...VALID_SENSOR_A }, { ...VALID_SENSOR_B }]),
      harness.api,
    );
    harness.triggerLaunch();

    // At 0ms: only the first sensor (delay=0) has started
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchCallCount).toBe(1);

    // At 200ms: the second sensor (delay=200) starts
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchCallCount).toBe(2);

    harness.triggerShutdown();
  });

  it('stops the existing handler and reconfigures it when discoverDevices runs again for the same sensor', async () => {
    const harness = createHarness();
    let fetchCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        fetchCallCount++;
        return makeSuccessFetch({ temperature: 25, humidity: 60 })();
      }),
    );

    const _platform = new SwitchBotDiscomfortIndexPlatform(
      harness.log,
      makeConfig([{ ...VALID_SENSOR_A }]),
      harness.api,
    );

    harness.triggerLaunch();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchCallCount).toBe(1); // first refresh

    // Same sensor triggers reconfiguration path
    harness.triggerLaunch();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.info).toHaveBeenCalledWith('Reconfiguring existing accessory:', VALID_SENSOR_A.name);
    expect(harness.registerPlatformAccessories).toHaveBeenCalledTimes(1); // no re-register
    expect(fetchCallCount).toBe(2); // first refresh after reconfiguration

    // Advance 60s: old interval is stopped, only new interval fires
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCallCount).toBe(3);

    harness.triggerShutdown();
  });
});

describe('DiscomfortIndexAccessory refresh/stop behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setupAndLaunch(harness: FakeApiHarness, fetchImpl: () => Promise<unknown>) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(fetchImpl));
    const platform = new SwitchBotDiscomfortIndexPlatform(
      harness.log,
      makeConfig([{ ...VALID_SENSOR_A }]),
      harness.api,
    );
    harness.triggerLaunch();
    return platform;
  }

  it('logs an error when fetch fails with a network error', async () => {
    const harness = createHarness();
    setupAndLaunch(harness, () => Promise.reject(new Error('network error')));

    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.error).toHaveBeenCalledWith(expect.stringContaining('network error'));
    harness.triggerShutdown();
  });

  it('logs an error when the HTTP response is not ok (e.g. 503)', async () => {
    const harness = createHarness();
    setupAndLaunch(harness, () =>
      Promise.resolve({ ok: false, status: 503, statusText: 'Service Unavailable' }),
    );

    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
    harness.triggerShutdown();
  });

  it('logs an error when SwitchBot API statusCode is not 100', async () => {
    const harness = createHarness();
    setupAndLaunch(harness, () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ statusCode: 190, message: 'Unauthorized', body: {} }),
      }),
    );

    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.error).toHaveBeenCalledWith(expect.stringContaining('statusCode=190'));
    harness.triggerShutdown();
  });

  it('logs a warning when temperature/humidity is non-finite', async () => {
    const harness = createHarness();
    setupAndLaunch(harness, makeSuccessFetch({}));

    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read temperature/humidity'),
      expect.anything(),
    );
    harness.triggerShutdown();
  });

  it('logs a debug message with the computed DI on success', async () => {
    const harness = createHarness();
    setupAndLaunch(harness, makeSuccessFetch({ temperature: 25, humidity: 60 }));

    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.debug).toHaveBeenCalledWith(expect.stringContaining('DI='));
    harness.triggerShutdown();
  });

  it('logs a timeout error (not a generic request error) when fetch throws TimeoutError', async () => {
    const harness = createHarness();
    const err = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    setupAndLaunch(harness, () => Promise.reject(err));

    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.error).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    expect(harness.log.error).not.toHaveBeenCalledWith(
      expect.stringContaining('SwitchBot API request failed'),
    );
    harness.triggerShutdown();
  });

  it('logs a timeout error when fetch throws AbortError', async () => {
    const harness = createHarness();
    const err = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    setupAndLaunch(harness, () => Promise.reject(err));

    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.error).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    harness.triggerShutdown();
  });

  it('logs an error when start() rejects', async () => {
    const harness = createHarness();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('test - fetch suppressed')));
    vi.spyOn(DiscomfortIndexAccessory.prototype, 'start').mockRejectedValue(new Error('start failure'));

    new SwitchBotDiscomfortIndexPlatform(harness.log, makeConfig([{ ...VALID_SENSOR_A }]), harness.api);
    harness.triggerLaunch();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.error).toHaveBeenCalledWith(
      expect.stringContaining(`[${VALID_SENSOR_A.name}] Handler failed to start: start failure`),
    );

    harness.triggerShutdown();
  });

  it('stops the interval after stop() so no additional fetches occur', async () => {
    const harness = createHarness();
    let fetchCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        fetchCallCount++;
        return makeSuccessFetch({ temperature: 25, humidity: 60 })();
      }),
    );
    new SwitchBotDiscomfortIndexPlatform(harness.log, makeConfig([{ ...VALID_SENSOR_A }]), harness.api);
    harness.triggerLaunch();

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchCallCount).toBe(1);

    harness.triggerShutdown();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCallCount).toBe(1);
  });
});

describe('SwitchBotDiscomfortIndexPlatform - configureAccessory cache restore flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('test - fetch suppressed')));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeCachedAccessory(sensor: SensorConfig): FakePlatformAccessory {
    const uuid = `uuid:switchbot-di-${sensor.deviceId}`;
    const service = createFakeService();
    return {
      displayName: sensor.name,
      UUID: uuid,
      context: { sensor },
      getService: vi.fn(() => service) as unknown as FakePlatformAccessory['getService'],
      addService: vi.fn(() => service) as unknown as FakePlatformAccessory['addService'],
      on: vi.fn(),
    };
  }

  it('takes the reconfiguration path when a cached accessory matches a config sensor', async () => {
    const harness = createHarness();
    const platform = new SwitchBotDiscomfortIndexPlatform(
      harness.log,
      makeConfig([{ ...VALID_SENSOR_A }]),
      harness.api,
    );

    platform.configureAccessory(makeCachedAccessory(VALID_SENSOR_A) as unknown as PlatformAccessory);

    harness.triggerLaunch();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.info).toHaveBeenCalledWith('Reconfiguring existing accessory:', VALID_SENSOR_A.name);
    expect(harness.registerPlatformAccessories).not.toHaveBeenCalled();

    harness.triggerShutdown();
  });

  it('registers sensors not in cache as new accessories', async () => {
    const harness = createHarness();
    const platform = new SwitchBotDiscomfortIndexPlatform(
      harness.log,
      makeConfig([{ ...VALID_SENSOR_A }, { ...VALID_SENSOR_B }]),
      harness.api,
    );

    platform.configureAccessory(makeCachedAccessory(VALID_SENSOR_A) as unknown as PlatformAccessory);

    harness.triggerLaunch();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.info).toHaveBeenCalledWith('Reconfiguring existing accessory:', VALID_SENSOR_A.name);
    expect(harness.log.info).toHaveBeenCalledWith('Registering new accessory:', VALID_SENSOR_B.name);
    expect(harness.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    const registered = harness.registerPlatformAccessories.mock.calls[0][2] as PlatformAccessory[];
    expect(registered[0].UUID).toBe(`uuid:switchbot-di-${VALID_SENSOR_B.deviceId}`);

    harness.triggerShutdown();
  });

  it('unregisters cached accessories that are no longer in config', async () => {
    const harness = createHarness();
    const platform = new SwitchBotDiscomfortIndexPlatform(
      harness.log,
      makeConfig([{ ...VALID_SENSOR_A }]),
      harness.api,
    );

    platform.configureAccessory(makeCachedAccessory(VALID_SENSOR_A) as unknown as PlatformAccessory);
    platform.configureAccessory(makeCachedAccessory(VALID_SENSOR_B) as unknown as PlatformAccessory);

    harness.triggerLaunch();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.info).toHaveBeenCalledWith('Reconfiguring existing accessory:', VALID_SENSOR_A.name);
    expect(harness.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
    const unregistered = harness.unregisterPlatformAccessories.mock.calls[0][2] as PlatformAccessory[];
    expect(unregistered).toHaveLength(1);
    expect(unregistered[0].UUID).toBe(`uuid:switchbot-di-${VALID_SENSOR_B.deviceId}`);
    expect(harness.registerPlatformAccessories).not.toHaveBeenCalled();

    harness.triggerShutdown();
  });

  it('logs an error when start() rejects in the reconfiguration path', async () => {
    const harness = createHarness();
    const platform = new SwitchBotDiscomfortIndexPlatform(
      harness.log,
      makeConfig([{ ...VALID_SENSOR_A }]),
      harness.api,
    );
    platform.configureAccessory(makeCachedAccessory(VALID_SENSOR_A) as unknown as PlatformAccessory);

    vi.spyOn(DiscomfortIndexAccessory.prototype, 'start').mockRejectedValue(new Error('start failure'));
    harness.triggerLaunch();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.log.error).toHaveBeenCalledWith(
      expect.stringContaining(`[${VALID_SENSOR_A.name}] Handler failed to start: start failure`),
    );

    harness.triggerShutdown();
  });
});
