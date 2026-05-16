# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A Homebridge platform plugin that calculates the Discomfort Index (DI) from temperature and humidity readings obtained via the SwitchBot OpenAPI v1.1, then exposes the value to HomeKit as a temperature sensor. The plugin does not depend on `homebridge-switchbot` or any other plugin.

## Development commands

```bash
npm install           # install dependencies
npm run build         # rimraf dist && tsc — outputs publish artifacts to dist/
npm test              # vitest run (same as CI)
npm run watch         # build → npm link → nodemon — rebuilds while linked to Homebridge
```

Running a single test file or filter:

```bash
npx vitest run src/utils.test.ts
npx vitest run -t 'invalid deviceId'   # filter by test name
npx vitest                              # watch mode
```

CI (`.github/workflows/ci.yml`) runs `npm ci && npm run build && npm test` on a Node 20 / 22 / 24 matrix. `prepublishOnly` also enforces build → test.

## Development workflow

Always create a worktree when starting an issue to prevent file conflicts between parallel sessions.

```bash
# Starting an issue (e.g. Issue #26)
git worktree add .worktrees/fix-fetch-timeout-26 -b fix/fetch-timeout-26
cd .worktrees/fix-fetch-timeout-26
npm install
npm test  # verify a clean baseline before making changes

# After the PR is merged (required)
cd <repo root>
git worktree remove .worktrees/fix-fetch-timeout-26
git branch -d fix/fetch-timeout-26
```

- Place worktrees under `.worktrees/` (already in `.gitignore`)
- Always delete the worktree and local branch after the PR is merged

## Architecture

The entry point follows the three-layer structure required by Homebridge's Dynamic Platform Plugin convention.

- **`src/index.ts`** — registers the platform with `api.registerPlatform(PLATFORM_NAME, ...)`. Nothing else.
- **`src/platform.ts`** (`SwitchBotDiscomfortIndexPlatform`) — platform core.
  - `configureAccessory()` is called by Homebridge during startup to push cache-restored accessories into `this.accessories`. It does not create handlers (the API is not ready yet).
  - The actual setup happens in `didFinishLaunching` via `discoverDevices()`. It iterates `config.sensors[]`, determines UUIDs with `uuid.generate('switchbot-di-' + deviceId)`, and register / reconfigure / unregister accessories based on the diff against the cache.
  - `handlers: Map<UUID, DiscomfortIndexAccessory>` holds one handler per accessory. `stop()` is always called on shutdown and on reconfiguration to prevent timer leaks.
- **`src/platformAccessory.ts`** (`DiscomfortIndexAccessory`) — one sensor = one handler.
  - **Important: HomeKit has no "Discomfort Index" characteristic, so the DI value is stored in `TemperatureSensor.CurrentTemperature`.** `setProps({ minValue: -50, maxValue: 150, minStep: 0.1 })` widens the allowed range. The Home app displays "X°C", but the number itself is the DI.
  - `start()` awaits the first `refresh()` and then sets up `setInterval`. Default `updateInterval` is 60 seconds, minimum 30 seconds (clamped by `Math.max(30, ...)`).
  - `start()` is separated from the constructor. The constructor is side-effect-free init only; I/O and timers live in `start()`. This is an invariant of this repo.
- **`src/utils.ts`** — pure functions only.
  - `calculateDiscomfortIndex(t, h)` — `0.81*T + 0.01*H*(0.99*T - 14.3) + 46.3`.
  - `buildSwitchBotAuthHeaders(token, secret, t, nonce)` — returns a base64 HMAC-SHA256(token+t+nonce) sign per the SwitchBot OpenAPI v1.1 auth spec.
  - `isValidDeviceId` — validates 12-digit hex strings (derived from BLE MAC addresses). Checked defensively in both `platform.ts` and `platformAccessory.ts`.

### SwitchBot API calls

`fetchStatus()` calls `GET /v1.1/devices/{deviceId}/status` and treats `statusCode !== 100` as an error (HTTP 200 can still carry an API-level error). On failure, the error is logged and the current interval tick is skipped; the next tick will retry. Non-finite `temperature` / `humidity` values are treated the same way.

## Testing

`src/*.test.ts` runs under vitest. Tests are excluded from the build via `tsconfig.json`'s `exclude` field.

`platform.test.ts` uses a custom harness (`createHarness`) that mocks the Homebridge API. `triggerLaunch()` fires the `didFinishLaunching` callback explicitly to drive `discoverDevices`. Follow this pattern when adding new platform behaviour.

`fetch` is stubbed globally with `vi.stubGlobal` to always reject, so no network I/O occurs during tests. `vi.useFakeTimers()` freezes `setInterval`.

## Code conventions

- TypeScript with `strict: true`. Do not relax types to work around errors.
- Use `this.platform.log` (`info` / `warn` / `error` / `debug`) for logging. No `console.log`.
- Log messages and code comments must be written in English.
- Conventional Commits (`feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:` / `ci:`). PRs merge into main.

## Config files

- `config.schema.json` — Homebridge UI form schema. Keep it in sync with `config.json` fields whenever they change.
- `engines.node` (`^20.19.0 || ^22.12.0 || ^24.0.0`) and `engines.homebridge` (`^1.8.0 || ^2.0.0-beta.0`) in `package.json` must match the CI matrix.
