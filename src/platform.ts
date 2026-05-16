import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME, UUID_PREFIX } from './settings';
import { DiscomfortIndexAccessory } from './platformAccessory';
import { isValidDeviceId, isSensorConfig, isValidToken } from './utils';

export class SwitchBotDiscomfortIndexPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  private readonly handlers = new Map<string, DiscomfortIndexAccessory>();

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('Initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });

    this.api.on('shutdown', () => {
      for (const handler of this.handlers.values()) {
        handler.stop();
      }
      this.handlers.clear();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Restoring accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private discoverDevices(): void {
    const token: unknown = this.config.token;
    const secret: unknown = this.config.secret;
    const rawSensors: unknown[] = Array.isArray(this.config.sensors) ? this.config.sensors : [];

    if (!isValidToken(token) || !isValidToken(secret)) {
      this.log.error('SwitchBot token/secret is missing or empty. Please check your config.json.');
      return;
    }

    if (rawSensors.length === 0) {
      this.log.warn('No sensors configured. Please add at least one sensor.');
    }

    const validUuids = new Set<string>();
    let startIndex = 0;

    for (const sensor of rawSensors) {
      if (!isSensorConfig(sensor)) {
        this.log.warn('Skipped a sensor with missing deviceId or name.');
        continue;
      }

      if (!isValidDeviceId(sensor.deviceId)) {
        this.log.warn(`Skipped a sensor with invalid deviceId: ${sensor.deviceId}`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${UUID_PREFIX}${sensor.deviceId}`);
      validUuids.add(uuid);

      const existing = this.accessories.find(a => a.UUID === uuid);
      const delay = startIndex * 200;
      startIndex++;

      if (existing) {
        this.log.info('Reconfiguring existing accessory:', existing.displayName);
        existing.context.sensor = sensor;
        this.handlers.get(uuid)?.stop();
        const reconHandler = new DiscomfortIndexAccessory(this, existing, token, secret);
        this.handlers.set(uuid, reconHandler);
        setTimeout(() => {
          reconHandler.start().catch(err => {
            const message = err instanceof Error ? err.message : String(err);
            this.log.error(`[${sensor.name}] Handler failed to start: ${message}`);
          });
        }, delay);
      } else {
        this.log.info('Registering new accessory:', sensor.name);
        const accessory = new this.api.platformAccessory(sensor.name, uuid);
        accessory.context.sensor = sensor;
        const newHandler = new DiscomfortIndexAccessory(this, accessory, token, secret);
        this.handlers.set(uuid, newHandler);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
        setTimeout(() => {
          newHandler.start().catch(err => {
            const message = err instanceof Error ? err.message : String(err);
            this.log.error(`[${sensor.name}] Handler failed to start: ${message}`);
          });
        }, delay);
      }
    }

    const stale = this.accessories.filter(a => !validUuids.has(a.UUID));
    if (stale.length > 0) {
      this.log.info(`Removing ${stale.length} stale accessor${stale.length === 1 ? 'y' : 'ies'}.`);
      // Stale entries are usually only restored from cache (no handler), but stop() is called
      // in case discoverDevices runs again in the same process.
      for (const accessory of stale) {
        this.handlers.get(accessory.UUID)?.stop();
        this.handlers.delete(accessory.UUID);
      }
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }
}
