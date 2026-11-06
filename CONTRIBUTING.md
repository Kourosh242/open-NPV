# Contributing to Open NPV

Thanks for helping. Open NPV is maintained by [Kourosh](https://github.com/kourosh242).

## Ground rules

- **Never commit real configuration files, passphrases, UUIDs, server addresses or
  decrypted output.** Tests use synthetic fixtures only (`example.invalid`, dummy keys).
- The project is **AGPL-3.0-only** because the format implementation derives from
  Pantegnos. Do not relicense, and keep `NOTICE` and `vendor/pantegnos/provenance.json`
  accurate when touching ported code.
- No new runtime dependency, CDN, font host, telemetry or network call may be added
  to the browser bundle. The browser test fails on any non-same-origin request.

## Setup

```sh
npm ci
npx playwright install chromium
npm run verify      # typecheck + unit tests + build + browser tests
npm run preview     # http://localhost:3000
```

## Before opening a pull request

1. `npm run verify` must pass.
2. `npm audit --audit-level=moderate` must be clean.
3. If you change decoding or conversion, add a synthetic fixture or vector and a
   unit test. Regenerating fixtures requires the pinned upstream Go checkout; see
   `tests/fixtures/README.md`.
4. If you change the UI, run the browser tests and check both themes plus a 390px
   viewport. Keep RTL, keyboard access and `prefers-reduced-motion` working.
5. Update `CHANGELOG.md`.

## Code style

- TypeScript, strict mode, no `any` in core code.
- Core modules stay free of DOM APIs so they run unchanged in Node and the worker.
- Persian user-facing strings; ASCII identifiers and comments in English.
- Prefer explicit failures (`DecodeError` with a code) over silent partial output.

## Reporting bugs

Open an issue with: browser and version, the container format/version reported by
the tool, the exact error message, and steps using a **synthetic** file. Do not
attach real exports. Security issues: see `SECURITY.md`.
