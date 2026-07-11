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
          "scale": 3,
          "offset": 60
        }
      ]
    }
  ]
}
```

| Field                      | Description                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `name`                     | Platform display name                                                                     |
| `token`                    | SwitchBot OpenAPI token                                                                   |
| `secret`                   | SwitchBot OpenAPI secret                                                                  |
| `sensors[].name`           | Name shown in HomeKit                                                                     |
| `sensors[].deviceId`       | 12-digit hex device ID                                                                    |
| `sensors[].updateInterval` | Polling interval in seconds (default 60, min 30, max 3600)                                |
| `sensors[].enableScale`    | Add a separate scaled accessory for finer triggers (default `false`)                      |
| `sensors[].scale`          | Factor multiplied with `(DI − offset)` on the scaled accessory (default 2, min 1, max 10) |
| `sensors[].offset`         | DI baseline subtracted before scaling (default 0, min 0, max 150)                         |

### Finer automation thresholds with a scaled accessory

HomeKit's Home app only lets you set temperature-sensor automation thresholds in **increments of 0.5**. Because the DI is exposed through `CurrentTemperature`, automations can only react in steps of 0.5 DI.

The base accessory always shows the **raw DI** — its display is never changed. When `enableScale` is on, an **additional accessory** (named `<name> Scaled`) is registered that exposes:

```
(DI − offset) × scale
```

Both accessories are driven by a **single API poll per interval**, so enabling the scaled accessory does not increase SwitchBot API usage.

This lets you "zoom into" the DI band you care about and trigger on it at much finer resolution. For example, with `offset: 60` and `scale: 3`:

- DI 60 → **0**, DI 75 → **45**, DI 90 → **90** — even the hottest realistic readings stay far below the 750 cap (only reached at DI 310)
- one HomeKit 0.5-step ≈ **0.17 DI**

> **Note:** HomeKit's automation trigger threshold can be set up to **750** (confirmed on iOS 26.5; not a documented HAP limit, so it may change), and the scaled value is clamped to the `-50…750` range. Choose `offset`/`scale` so the band you care about maps into `0…750` — the largest representable DI is `offset + 750 / scale`, and any DI below `offset − 50 / scale` is clamped to the `-50` floor. The base raw-DI accessory is unaffected by these settings.

## Versioning

This plugin follows [Semantic Versioning](https://semver.org/) against its **configuration contract** — the fields defined in `config.schema.json` and the behaviour they produce in HomeKit:

- platform level: `name`, `token`, `secret`, `sensors[]`
- per sensor: `name`, `deviceId`, `updateInterval`, `enableScale`, `scale`, `offset`

Releases are numbered against that contract:

- **Major** — a breaking config change: a field is removed or renamed, or a default changes in a way that alters behaviour. Your `config.json` may need editing.
- **Minor** — a new opt-in field or feature. Existing configs keep working unchanged.
- **Patch** — bugfixes, dependency updates, documentation.

## Development & Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

```bash
npm install
npm run build
npm test
```

## License

Apache-2.0
