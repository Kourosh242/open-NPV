# Changelog

All notable changes to Open NPV are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-11-12

First stable release. Audited end to end with the `find-bugs` (Sentry) and
`web-design-guidelines` skills; the fixes below are the ones that survived
verification on the real build and browser suite.

### Fixed
- A malformed share link embedded inside an export no longer aborts the whole
  decode; the offending string is kept as raw, clearly-warned JSON while the
  rest of the file converts normally.
- Empty Base64 input now reports `FORMAT` (invalid Base64) instead of `LIMIT`
  ("too big"), so paste/empty-field errors say what actually happened.
- Icon-only install button kept an accessible name on mobile layouts
  (`aria-label`; previously the label text was `display:none` and the icon is
  `aria-hidden`).
- Three physical `left/right` declarations replaced with logical properties
  (`margin-inline-start`, `text-align: end`) — equivalent rendering in RTL,
  correct in either direction.
- The copy fallback textarea no longer needs inline styles; hidden via a class.

### Changed
- Content Security Policy hardened: `style-src 'self'` (dropped `'unsafe-inline'`);
  no inline style attributes remain anywhere.
- `::placeholder` colour is explicit (`--muted`) in both themes; buttons get
  `touch-action: manipulation`; dialogs get `overscroll-behavior: contain`.
- Placeholder copy uses the proper ellipsis character (`…`).

### Hardened in the follow-up audit
- WCAG AA contrast verified by measurement for every text/icon colour pair in both themes.
- Keyboard/focus audit scripted and verified: skip link, dialog focus trap, focus return to trigger, `aria-pressed` toggles, 320 px layout without horizontal overflow, `prefers-reduced-motion` honoured with 220 ms card animation collapsing as specified.
- `prefers-reduced-transparency` and `forced-colors` support added; tiny icon buttons enlarged to 32 px; `content-visibility: auto` on result cards; `text-wrap: balance` on headings; `theme.js` now runs before the stylesheet (no colour flash even in edge conditions).
- Lightweight UX copy: `Intl.NumberFormat('fa-IR')` for counts; `aria-describedby` ties the paste hint to its textarea; `og:image` and `twitter:card` meta added.
- Preview server resolves symlinks and refuses to serve anything outside `site/`.
- Unit coverage extended to 27 tests (sentinels, trojan redaction, root-string salvage, empty NPVT tokens, Go-compatible trailing-bit Base64).
- `og:locale` added alongside the existing Open Graph/Twitter meta.
- `site/source.zip` now also ships `.editorconfig`, so the archived source matches the repository exactly.
- `docs/UI-UX.md` section numbering fixed (۱–۷) and stray `</div>` artefacts removed from `docs/UI-UX.md` and `docs/DEPLOY.fa.md`; `SECURITY.md` now names the 1.0.x series.
- NPVT decoder skips empty tokens between commas (matching upstream behaviour) instead of aborting the file; Base64 decoding tolerates non-zero trailing bits like Go's non-strict decoder, while keeping alphabet/padding/length checks.

### Versioning
- `package.json`, `package-lock.json`, `NOTICE`, `README` badge, the footer,
  the about dialog and the ZIP `report.json` generator all report **1.0.0**.

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
- Pending, locked and failed file groups are no longer hidden when a search/protocol
  filter is active; a filter must never conceal a password prompt or an error.
- The preview server answers only GET/HEAD (405 otherwise), strips the body for HEAD
  and sends a correct Content-Length.

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
