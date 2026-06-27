# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.2] - 2026-06-27

### Changed

- Documentation: scaled-accessory examples now use a scale of 3 instead of 10,
  a more realistic value for typical DI bands (#16)
- Internal: updated development dependencies and CI actions (no runtime impact)

## [0.2.1] - 2026-06-23

### Fixed

- Scaled accessory name no longer ends with `)`; the suffix is now ` Scaled`
  instead of ` (scaled)`, which HomeKit rejected on rename because a name must
  begin and end with a letter or number (#13)

## [0.2.0] - 2026-06-23

### Added

- Opt-in scaled Discomfort Index accessory: when `enableScale` is set, an additional accessory exposes `(DI - offset) * scale`, enabling finer-grained HomeKit automation triggers. The device status is fetched once per interval and shared between the base and scaled accessories, so scaling adds no extra API calls (`scale`, `offset` config fields)

### Fixed

- Stale readings: once the last successful reading is older than `STALE_INTERVAL_FACTOR` update intervals (3 by default), the getters now throw `SERVICE_COMMUNICATION_FAILURE` so HomeKit stops acting on stale data; a fresh success clears the staleness (closes #8)
- Exclude the `.serena/` tooling directory from the published npm package

### Refactored

- Hardened the scaled DI configuration types (closes #9)

## [0.1.0] - 2026-05-10

### Added

- Initial Homebridge platform plugin implementation — calculates the Discomfort Index from SwitchBot temperature/humidity data and exposes it to HomeKit
- HMAC-SHA256 auth header generation for SwitchBot OpenAPI v1.1 (`buildSwitchBotAuthHeaders`)
- Discomfort Index formula `DI = 0.81×T + 0.01×H×(0.99×T − 14.3) + 46.3` (`calculateDiscomfortIndex`)
- Multi-sensor support
- Configurable polling interval via `updateInterval` (default 60 s, minimum 30 s)
- 12-digit hex `deviceId` validation (`isValidDeviceId`)
- GitHub Actions CI (Node 20 / 22 / 24 matrix)
- Dependabot automatic dependency update config
- ESLint + Prettier code quality tooling
- Unit tests and coverage measurement with vitest (threshold 80%)
- Homebridge UI form schema via `config.schema.json`
- `CLAUDE.md` developer guide for AI agents

### Fixed

- Timer leak: `stop()` now reliably clears the interval
- `deviceId` validation: invalid IDs are skipped with a log message
- Fetch timeout added to SwitchBot API calls (10 s)
- `handler.start()` rejection is now caught and logged via `.catch()`
- `handleGet()` returning 0°C before the first successful refresh — `start()` now awaits the first fetch before starting `setInterval`

### Refactored

- `start()` separated from constructor (constructor is side-effect-free; I/O and timers live in `start()`)
- UUID prefix `'switchbot-di-'` extracted to constant `UUID_PREFIX`
- `AccessoryInformation` Manufacturer / Model / FirmwareRevision now read from `package.json`
- Input validation strengthened for `token`, `secret`, and `updateInterval` (type guards `isValidToken` / `isValidUpdateInterval`)
- API spike prevention: 200 ms offset between sensor startups when multiple sensors are configured

### Security

- Documented policy: never log HMAC auth header values (`sign` / `Authorization`)

[Unreleased]: https://github.com/kamine81/homebridge-switchbot-discomfort-index/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/kamine81/homebridge-switchbot-discomfort-index/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/kamine81/homebridge-switchbot-discomfort-index/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kamine81/homebridge-switchbot-discomfort-index/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kamine81/homebridge-switchbot-discomfort-index/releases/tag/v0.1.0
