# homebridge-switchbot-discomfort-index

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
          "updateInterval": 60
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

## Development & Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

```bash
npm install
npm run build
npm test
```

## License

Apache-2.0
