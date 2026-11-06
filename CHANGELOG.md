# Changelog

All notable changes to Open NPV are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.2.1] — 2026-11-06

### Fixed
- Embedded `ss://` share links inside exports now recover the endpoint (host/port)
  and fragment name, so those cards behave like the other protocols in search and copy.
- Multi-outbound name suffix no longer counts `loopback` outbounds (it skipped them
  for output but included them in the tally).
- Downloaded file names now strip the `.npvo` extension as well.
- The passphrase unwrap key is zeroed after use on the success path too.
- The offline-cache build hash no longer depends on the OS path separator, so identical
  content produces the same Service Worker version everywhere.
- `package-lock.json` was behind `package.json`; both now match at 0.2.1.

### Removed
- First-time "publish on GitHub Pages" setup instructions and the `release:zip` helper;
  the repository and site are already live at https://kourosh242.github.io/open-NPV/
  and every push to `main` deploys automatically. `docs/DEPLOY.fa.md` now covers the
  automated flow and troubleshooting only.

### Added
- Unit coverage for embedded share-link extraction (20 tests in total).
- Repository homepage and `og:url` point at https://kourosh242.github.io/open-NPV/.

## [0.2.0] — 2026-10-30

### Added
- Redesigned Persian RTL interface: sticky header, three-step flow, support matrix,
  FAQ, and a calmer results panel.
- Vazirmatn is now used for all interface text, loaded locally and preloaded.
- Protocol filter chips, search with `/` shortcut, and an explicit empty-filter state.
- Per-file removal, queue progress, and incremental rendering for large exports.
- Copy confirmation on the button itself, plus typed toasts (success/error/info).
- Password show/hide control and inline wrong-password recovery.
- Sticky mobile action bar for copy and ZIP.
- System-aware theme with a pre-paint `theme.js` (no colour flash).
- Update consent dialog: a new version never discards open results silently.
- Author attribution for [Kourosh242](https://github.com/Kourosh242) across the UI,
  manifest, package metadata and documentation.
- `docs/DEPLOY.fa.md`, `docs/UI-UX.md`, `CONTRIBUTING.md`, issue templates.
- `npm run verify` and `npm run release:zip`.

### Changed
- Project renamed from `npv-open` to **open-npv** (package, cache scope, storage key,
  worker names, export filenames and documentation).
- ZIP packing moved off the main thread into a worker.
- Batch copy/download now follow the active filter, and say so.
- GitHub Actions workflow updated to current action majors and Node 24; pull
  requests run the full test suite without deploying.

### Fixed
- Downloads of Persian-named files lost their filename and extension in Chromium;
  on-disk names are now ASCII while Persian names stay intact in the UI and report.
- The font's Persian-digit feature rewrote digits inside file and config names.
- Server endpoint line was left-aligned inside an otherwise right-aligned card.
- Toast overlapped the sticky mobile action bar.
- On mobile, selecting a file scrolled to the input panel instead of the results.
- File groups could be reordered/duplicated when re-rendered.
- Re-entrant ZIP requests could leave export buttons disabled.
- First install could be presented as an available update.

## [0.1.0]

- Initial local-first NPVT/NPVS extractor: NPVT1, NPVS v0/v1/v5 (app key and
  passphrase), NPVO1, share links for VLESS/VMess/Trojan/Shadowsocks, raw JSON
  fallback, offline PWA, synthetic differential tests against the pinned Go
  implementation.
