# Contributing Guide

Bug reports, feature requests, and pull requests are welcome.

## Environment setup

We recommend [mise](https://mise.jdx.dev/) to manage Node.js versions (a `.mise.toml` is included).

```bash
mise install          # install Node.js version defined in .mise.toml
npm install
npm run build
npm test
```

Supported Node.js versions: `^20.19.0 || ^22.12.0 || ^24.0.0`

## Development commands

```bash
npm run build    # compile TypeScript → dist/
npm test         # run tests with vitest
npm run lint     # ESLint + Prettier check
npm run watch    # build → npm link → nodemon (link to local Homebridge)
```

## Linking to a local Homebridge

```bash
npm link
# Add "platform": "SwitchBotDiscomfortIndex" to your Homebridge config and start it
```

## Branch naming

```
feat/<description>-<issue-number>
fix/<description>-<issue-number>
refactor/<description>-<issue-number>
docs/<description>-<issue-number>
chore/<description>-<issue-number>
```

## Commit message convention

Follow [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>: <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`, `perf`, `security`

## Pull request workflow

1. Open an issue to align on the approach before starting implementation
2. Branch off `main`
3. Confirm `npm run build && npm test && npm run lint` all pass
4. Create a PR following `.github/PULL_REQUEST_TEMPLATE.md`
5. Request a review once CI (Node 20/22/24 matrix) is green

## Testing guidelines

- Add unit tests for new functionality
- Stub `fetch` with `vi.stubGlobal` so no real network I/O occurs
- Control timers with `vi.useFakeTimers()`
- Coverage thresholds: statements / branches / functions / lines all ≥ 80%

## Code of conduct

Provide constructive feedback and respect all participants.
