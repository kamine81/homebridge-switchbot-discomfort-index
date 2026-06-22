import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { randomUUID } from 'crypto';

import pkg from '../package.json';
import { SCALED_NAME_SUFFIX, SWITCHBOT_API_BASE, SWITCHBOT_API_TIMEOUT_MS } from './settings';
import { SwitchBotDiscomfortIndexPlatform } from './platform';
import { buildSwitchBotAuthHeaders, calculateDiscomfortIndex, isSensorConfig, isValidDeviceId, resolveOffset, resolveScale, resolveUpdateInterval, type SensorConfig } from './utils';

export type { SensorConfig } from './utils';

// Empirically, the Home app's automation threshold picker for a temperature sensor (confirmed on
// iOS 26.5) only accepts values up to 750; values beyond that cannot be selected as a trigger.
// The exposed (scaled) value must stay within this range or it is useless as a trigger. This is not
// part of any documented HAP spec, so revisit if Apple changes the picker behaviour.
const DI_MIN_VALUE = -50;
const DI_MAX_VALUE = 750;

function clampToRange(value: number): number {
  return Math.min(DI_MAX_VALUE, Math.max(DI_MIN_VALUE, value));
}

interface SwitchBotStatusResponse {
  statusCode: number;
  message: string;
  body: {
    temperature?: number;
    humidity?: number;
    [key: string]: unknown;
  };
}

// One handler per device. It owns the base accessory (raw DI) and, when configured, an additional
// scaled accessory exposing (DI - offset) * scale. The device status is fetched once per interval
// and used to update both accessories, so enabling scaling does not add extra API calls.
export class DiscomfortIndexAccessory {
  private readonly sensor: SensorConfig;
  private readonly baseService: Service;
  private readonly scaledService?: Service;
  private readonly scale: number;
  private readonly offset: number;
  private currentDI = 0;       // raw DI exposed by the base accessory
  private currentScaled = 0;   // (DI - offset) * scale exposed by the scaled accessory
  private ready = false;
  private timer?: NodeJS.Timeout;
  // Track whether each value is currently being clamped, so the warning is logged once per clamping
  // episode instead of every interval. Reset when the value falls back within range.
  private baseClampWarned = false;
  private scaledClampWarned = false;

  constructor(
    private readonly platform: SwitchBotDiscomfortIndexPlatform,
    accessory: PlatformAccessory,
    private readonly token: string,
    private readonly secret: string,
    scaledAccessory?: PlatformAccessory,
  ) {
    const raw: unknown = accessory.context.sensor;
    if (!isSensorConfig(raw)) {
      throw new Error('Invalid or missing sensor config in accessory context');
    }
    this.sensor = raw;

    if (!isValidDeviceId(this.sensor.deviceId)) {
      throw new Error(`Invalid deviceId format: ${this.sensor.deviceId}`);
    }

    // The base accessory always exposes the raw DI.
    this.baseService = this.setupService(
      accessory,
      this.sensor.name,
      this.sensor.deviceId,
      this.handleGetBase.bind(this),
    );

    // The scaled accessory exposes (DI - offset) * scale so HomeKit automation thresholds (which step
    // in increments of 0.5) can target a finer DI granularity.
    if (scaledAccessory) {
      const { value: scale, warning: scaleWarning } = resolveScale(this.sensor.scale);
      const { value: offset, warning: offsetWarning } = resolveOffset(this.sensor.offset);
      const scaledName = this.sensor.name + SCALED_NAME_SUFFIX;
      if (scaleWarning) {
        this.platform.log.warn(`[${scaledName}] ${scaleWarning}`);
      }
      if (offsetWarning) {
        this.platform.log.warn(`[${scaledName}] ${offsetWarning}`);
      }
      this.scale = scale;
      this.offset = offset;
      this.scaledService = this.setupService(
        scaledAccessory,
        scaledName,
        `${this.sensor.deviceId}-scaled`,
        this.handleGetScaled.bind(this),
      );
    } else {
      this.scale = 1;
      this.offset = 0;
    }
  }

  // Configures the AccessoryInformation and TemperatureSensor services on an accessory.
  private setupService(
    accessory: PlatformAccessory,
    displayName: string,
    serialNumber: string,
    onGet: () => CharacteristicValue,
  ): Service {
    accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'SwitchBot')
      .setCharacteristic(this.platform.Characteristic.Model, pkg.displayName)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, pkg.version)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, serialNumber);

    const service = accessory.getService(this.platform.Service.TemperatureSensor)
      || accessory.addService(this.platform.Service.TemperatureSensor);

    service.setCharacteristic(this.platform.Characteristic.Name, displayName);

    // The HomeKit CurrentTemperature standard range is -270–100 °C. Both the base and scaled services
    // share these props for simplicity; maxValue is widened to 750 for the scaled service's sake (see
    // DI_MAX_VALUE above). The base raw DI never approaches the bounds, but its value is clamped in
    // refresh() defensively all the same.
    service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(onGet)
      .setProps({ minValue: DI_MIN_VALUE, maxValue: DI_MAX_VALUE, minStep: 0.1 });

    accessory.on('identify', () => {
      this.platform.log.info(`[${displayName}] identify`);
    });

    return service;
  }

  async start(): Promise<void> {
    const { value: intervalSec, warning } = resolveUpdateInterval(this.sensor.updateInterval);
    if (warning) {
      this.platform.log.warn(`[${this.sensor.name}] ${warning}`);
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

  private handleGetBase(): CharacteristicValue {
    this.ensureReady();
    return this.currentDI;
  }

  private handleGetScaled(): CharacteristicValue {
    this.ensureReady();
    return this.currentScaled;
  }

  private ensureReady(): void {
    if (!this.ready) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  // Clamps a value to the HomeKit range and, if it actually clamped, logs a warning once per clamping
  // episode (tracked by the caller's getWarned/setWarned). The flag resets when the value is back in
  // range, so a new episode after recovery warns again. `hint` adds caller-specific guidance.
  private clampWithWarning(
    label: string,
    raw: number,
    getWarned: () => boolean,
    setWarned: (v: boolean) => void,
    hint = '',
  ): number {
    const clamped = clampToRange(raw);
    if (clamped === raw) {
      setWarned(false);
      return clamped;
    }
    if (!getWarned()) {
      this.platform.log.warn(
        `[${label}] value ${raw} clamped to ${clamped} (allowed ${DI_MIN_VALUE}..${DI_MAX_VALUE})${hint}.`,
      );
      setWarned(true);
    }
    return clamped;
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
      const rawDI = Math.round(di * 10) / 10;
      // The raw DI normally stays well within range; clamp defensively but warn if it ever fires, as
      // that signals an upstream problem (e.g. an absurd-but-finite reading) rather than mere scaling.
      this.currentDI = this.clampWithWarning(sensor.name, rawDI, () => this.baseClampWarned, v => {
        this.baseClampWarned = v;
      });
      this.baseService.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        this.currentDI,
      );

      let scaledDebug = '';
      if (this.scaledService) {
        const scaledValue = Math.round((di - this.offset) * this.scale * 10) / 10;
        // Clamping here means scale/offset push the value past HomeKit's usable range, so the
        // accessory pegs at a boundary and automations stop tracking the DI.
        this.currentScaled = this.clampWithWarning(
          `${sensor.name}${SCALED_NAME_SUFFIX}`,
          scaledValue,
          () => this.scaledClampWarned,
          v => {
            this.scaledClampWarned = v;
          },
          `; check scale=${this.scale}/offset=${this.offset}`,
        );
        this.scaledService.updateCharacteristic(
          this.platform.Characteristic.CurrentTemperature,
          this.currentScaled,
        );
        scaledDebug = ` [scaled (DI-${this.offset})×${this.scale} = ${scaledValue}`
          + (this.currentScaled !== scaledValue ? ` → clamped ${this.currentScaled}]` : ']');
      }

      this.ready = true;

      this.platform.log.debug(
        `[${sensor.name}] T=${t}℃ H=${h}% → DI=${rawDI}${scaledDebug}`,
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
