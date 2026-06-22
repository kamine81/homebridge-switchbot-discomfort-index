# homebridge-switchbot-discomfort-index

[![npm version](https://img.shields.io/npm/v/homebridge-switchbot-discomfort-index.svg)](https://www.npmjs.com/package/homebridge-switchbot-discomfort-index)
[![npm downloads](https://img.shields.io/npm/dm/homebridge-switchbot-discomfort-index.svg)](https://www.npmjs.com/package/homebridge-switchbot-discomfort-index)
[![CI](https://github.com/kamine81/homebridge-switchbot-discomfort-index/actions/workflows/ci.yml/badge.svg)](https://github.com/kamine81/homebridge-switchbot-discomfort-index/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/homebridge-switchbot-discomfort-index.svg)](./LICENSE)

A Homebridge plugin that fetches temperature and humidity from SwitchBot temperature/humidity devices via the SwitchBot OpenAPI v1.1, calculates the Discomfort Index (DI), and exposes it to HomeKit as a temperature sensor.

## Discomfort Index formula

```
DI = 0.81 × T + 0.01 × H × (0.99 × T − 14.3) + 46.3
```

- T: temperature (°C)
- H: relative humidity (%)

## How it works

This plugin calls the SwitchBot OpenAPI v1.1 directly to read `temperature` and `humidity` from your device. It does **not** depend on `homebridge-switchbot` or any other plugin.

HomeKit has no standard "Discomfort Index" characteristic, so the DI value is stored in `TemperatureSensor.CurrentTemperature`. The Home app will show it as "°C", but the numeric value is the DI.

## Installation

```bash
npm install -g homebridge-switchbot-discomfort-index
```

## Getting your SwitchBot token and secret

1. Open the SwitchBot app → Profile → Settings → tap **App Version** 10 times
2. **Developer Options** will appear — open it
3. Copy your **Token** and **Secret**

## Getting your device ID

```bash
TOKEN="..."
SECRET="..."
T=$(date +%s%3N)
NONCE=$(uuidgen)
SIGN=$(echo -n "${TOKEN}${T}${NONCE}" | openssl dgst -sha256 -hmac "${SECRET}" -binary | base64)

curl -s https://api.switch-bot.com/v1.1/devices \
  -H "Authorization: ${TOKEN}" \
  -H "sign: ${SIGN}" \
  -H "t: ${T}" \
  -H "nonce: ${NONCE}" | jq
```

Find the `deviceId` of your temperature/humidity device in the `deviceList` array of the response.

## Configuration example

```json
{
  "platforms": [
    {
      "platform": "SwitchBotDiscomfortIndex",
      "name": "SwitchBot Discomfort Index",
      "token": "YOUR_TOKEN",
      "secret": "YOUR_SECRET",
      "sensors": [
        {
          "name": "Living Room DI",
          "deviceId": "XXXXXXXXXXXX",
          "updateInterval": 60,
          "enableScale": true,
          "scale": 2
        }
      ]
    }
  ]
}
```

| Field | Description |
| --- | --- |
| `name` | Platform display name |
| `token` | SwitchBot OpenAPI token |
| `secret` | SwitchBot OpenAPI secret |
| `sensors[].name` | Name shown in HomeKit |
| `sensors[].deviceId` | 12-digit hex device ID |
| `sensors[].updateInterval` | Polling interval in seconds (default 60, min 30, max 3600) |
| `sensors[].enableScale` | Opt-in to scaling the DI before exposing it (default `false`) |
| `sensors[].scale` | Factor multiplied with the DI when `enableScale` is `true` (default 2, min 1, max 10) |

### Finer automation thresholds with `scale`

HomeKit's Home app only lets you set temperature-sensor automation thresholds in **increments of 0.5**. Because the DI is exposed through `CurrentTemperature`, that means automations can only react in steps of 0.5 DI by default.

Enabling `scale` multiplies the DI before it reaches HomeKit, so a 0.5-unit HomeKit step maps to a finer DI step:

- `scale: 2` → one HomeKit 0.5-step ≈ **0.25 DI**
- `scale: 5` → one HomeKit 0.5-step ≈ **0.1 DI**

> **Note:** When scaling is enabled, the Home app displays **DI × scale** (e.g. DI 75 shows as 150 with `scale: 2`). This is expected — the number is intentionally inflated to gain finer trigger precision. Leave `enableScale` off (the default) to keep the raw DI value.
>
> HomeKit's automation trigger threshold is capped at **150**, so the scaled value is clamped to 150. Pick a `scale` such that the DI range you care about stays under 150 (e.g. with `scale: 2`, DI up to 75 is representable). DI values above the cap are reported as 150.

## Development & Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

```bash
npm install
npm run build
npm test
```

## License

Apache-2.0
