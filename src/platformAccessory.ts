import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { randomUUID } from 'crypto';

import pkg from '../package.json';
import { SWITCHBOT_API_BASE, SWITCHBOT_API_TIMEOUT_MS } from './settings';
import { SwitchBotDiscomfortIndexPlatform } from './platform';
import { buildSwitchBotAuthHeaders, calculateDiscomfortIndex, isSensorConfig, isValidDeviceId, resolveUpdateInterval, type SensorConfig } from './utils';

export type { SensorConfig } from './utils';

interface SwitchBotStatusResponse {
  statusCode: number;
  message: string;
  body: {
    temperature?: number;
    humidity?: number;
    [key: string]: unknown;
  };
}

export class DiscomfortIndexAccessory {
  private service: Service;
  private readonly sensor: SensorConfig;
  private currentDI = 0;
  private ready = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly platform: SwitchBotDiscomfortIndexPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly token: string,
    private readonly secret: string,
  ) {
    const raw: unknown = accessory.context.sensor;
    if (!isSensorConfig(raw)) {
      throw new Error('Invalid or missing sensor config in accessory context');
    }
    this.sensor = raw;

    if (!isValidDeviceId(this.sensor.deviceId)) {
      throw new Error(`Invalid deviceId format: ${this.sensor.deviceId}`);
    }

    accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'SwitchBot')
      .setCharacteristic(this.platform.Characteristic.Model, pkg.displayName)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, pkg.version)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.sensor.deviceId);

    this.service = this.accessory.getService(this.platform.Service.TemperatureSensor)
      || this.accessory.addService(this.platform.Service.TemperatureSensor);

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.sensor.name);

    // The HomeKit CurrentTemperature standard range is -270–100 °C.
    // Discomfort Index (typically 50–90) fits within that, but props are set explicitly for clarity.
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleGet.bind(this))
      .setProps({ minValue: -50, maxValue: 150, minStep: 0.1 });

    this.accessory.on('identify', () => {
      this.platform.log.info(`[${this.sensor.name}] identify`);
    });
  }

  async start(): Promise<void> {
    const sensor = this.sensor;
    const { value: intervalSec, warning } = resolveUpdateInterval(sensor.updateInterval);
    if (warning) {
      this.platform.log.warn(`[${sensor.name}] ${warning}`);
    }
    await this.refresh();
    this.timer = setInterval(() => this.refresh(), intervalSec * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private handleGet(): CharacteristicValue {
    if (!this.ready) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
    return this.currentDI;
  }

  private async refresh(): Promise<void> {
    const sensor = this.sensor;
    try {
      const body = await this.fetchStatus(sensor.deviceId);
      const t = Number(body.temperature);
      const h = Number(body.humidity);

      if (!Number.isFinite(t) || !Number.isFinite(h)) {
        this.platform.log.warn(
          `[${sensor.name}] Failed to read temperature/humidity:`,
          body,
        );
        return;
      }

      const di = calculateDiscomfortIndex(t, h);
      this.currentDI = Math.round(di * 10) / 10;
      this.ready = true;

      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        this.currentDI,
      );

      this.platform.log.debug(
        `[${sensor.name}] T=${t}℃ H=${h}% → DI=${this.currentDI}`,
      );
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        this.platform.log.error(
          `[${sensor.name}] SwitchBot API timed out (${SWITCHBOT_API_TIMEOUT_MS}ms)`,
        );
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.platform.log.error(
        `[${sensor.name}] SwitchBot API request failed: ${message}`,
      );
      if (err instanceof Error && err.stack) {
        this.platform.log.debug(`[${sensor.name}] ${err.stack}`);
      }
    }
  }

  private async fetchStatus(deviceId: string) {
    // Never log the sign or Authorization header values.
    const headers = buildSwitchBotAuthHeaders(
      this.token,
      this.secret,
      Date.now().toString(),
      randomUUID(),
    );

    const res = await fetch(`${SWITCHBOT_API_BASE}/v1.1/devices/${deviceId}/status`, {
      method: 'GET',
      headers: {
        Authorization: this.token,
        sign: headers.sign,
        t: headers.t,
        nonce: headers.nonce,
        'Content-Type': 'application/json; charset=utf-8',
      },
      signal: AbortSignal.timeout(SWITCHBOT_API_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    let json: SwitchBotStatusResponse;
    try {
      json = await res.json() as SwitchBotStatusResponse;
    } catch {
      throw new Error('Failed to parse SwitchBot API response as JSON');
    }

    if (json.statusCode !== 100) {
      throw new Error(`SwitchBot API error: ${json.message} (statusCode=${json.statusCode})`);
    }

    return json.body;
  }
}
