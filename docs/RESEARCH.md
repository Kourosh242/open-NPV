# Research notes and format decisions

This project was implemented after inspecting the application exports, an existing
open-source decoder, the user's offline-first reference project, and Xray share-link
semantics. The notes below record the decisions that affect compatibility and trust.

## Sources inspected

- Pantegnos, pinned commit `1bb2a6743e6d1dc85e9d5e38edad68975ad1fc37`:
  <https://github.com/FrontierTM/Pantegnos>. The NPVT/NPVS parsers, white-box table
  networks, key derivation, NPF field handling, and URI mapping were ported to
  TypeScript. Upstream is AGPL-3.0-only; this project therefore uses the same license.
- IR-Toolbox: <https://github.com/Kourosh242/IR-Toolbox>. Reviewed as a Persian,
  static, offline-first PWA reference. Open NPV uses its own interface and code;
  the local Vazirmatn font and MIT attribution are retained.
- Xray share-link discussion: <https://github.com/XTLS/Xray-core/discussions/716>
  and libXray: <https://github.com/XTLS/libxray>. Used to check VLESS/VMess/Trojan/
  Shadowsocks URI fields, Base64 variants, IPv6 authority formatting, REALITY
  parameters, and the difference between a share link and a full Xray JSON config.
- MDN Service Worker and Cache API documentation:
  <https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API> and
  <https://developer.mozilla.org/en-US/docs/Web/API/Cache>. Used for atomic install,
  scoped caches, and offline navigation.

## Container findings

### NPVT1

- Text container beginning with `NPVT1`, followed by comma-separated tokens.
- Each token is hex or Base64. The first 16 bytes are a nonce/counter; the remainder
  is decrypted with the NPVT white-box AES-CTR network and a 128-bit counter.
- The plaintext is JSON. Real exports can contain a scalar count, an array of
  configuration objects, and a lock-policy object. Only configuration objects are
  extracted; container metadata is not reported as an extra proxy.
- NPVT1 has no AEAD tag. Successful JSON parsing is not creator authentication.

### NPVS

- Binary container beginning with `NPVS`.
- Versions 0/1 use a JSON header as additional authenticated data. Version 5 uses a
  compact binary header, encrypted metadata, and an encrypted NPF field table.
- Unlock methods observed: recipient/ECDH (0), passphrase (1), app key (2).
  Recipient mode is intentionally unsupported because it requires the recipient's
  private key.
- Passphrase mode uses PBKDF2-HMAC-SHA256 to unwrap a data-encryption key, then
  ChaCha20-Poly1305. The supplied real v5 sample declared 600000 iterations.
- App-key mode uses white-box derived key-encryption keys. Version 5 uses the
  generation-2 A16/KDK network; versions 0/1 try the two documented legacy variants.
- NPF fields are individually AEAD-protected. Field 65535 contains the configuration
  reference table. Field derivation info includes the field label and a raw big-endian
  16-bit sequence number. A missing or failed field aborts the whole file; partial
  output is not presented as a successful decode.
- A trailing 64-byte signature exists in the format, but the reference open path does
  not establish a trusted creator key. Open NPV does not claim Ed25519 identity
  verification.

### NPVO1 and sentinels

- `NPVO1` is an open JSON export. `npvs1:` strings inside JSON are Base64-encoded
  field values and are decoded locally. They are not treated as executable content.

## Conversion policy

- VLESS, VMess, Trojan, and Shadowsocks receive share links when a lossless mapping
  is possible. SSH, unknown protocols, multiple servers/users in one outbound,
  Shadowsocks plugins/UoT, `sockopt`, `finalmask`, and unsupported transports remain
  available as full recovered JSON with an explicit warning.
- Host/fronting headers are kept separate from TLS SNI. Paths are percent-encoded.
  IPv6 authorities are bracketed. REALITY keeps `pbk`, `sni`, `fp`, `spx`, and an
  explicitly empty `sid` when present.
- VMess TCP with `headerType=none` and QUIC do not carry an HTTP path/host in the
  legacy share payload; default `/` is not invented.
- A recovered JSON object is not guaranteed to import into every client. Proprietary
  NPV fields may have no equivalent elsewhere. The tool does not test connectivity,
  ping servers, or validate subscriptions.

## Privacy and offline decisions

- All parsing and cryptography run in a dedicated Web Worker. No upload endpoint,
  analytics, external font, CDN, or telemetry exists.
- Passphrases are requested only in the local UI. They are never logged, persisted,
  or sent over the network. JavaScript cannot guarantee secure erasure of every
  string copy, and the UI/README state this limitation.
- Previews are masked by default. Copy and downloads are explicit user actions and
  contain the full configuration.
- The build generates a hash-versioned Service Worker. Installation uses
  `cache.addAll` so the shell, decoder, tables, font, icons, demo, and corresponding
  source archive become available atomically. Cache names are scoped to the exact
  deployment path so sibling GitHub Pages projects are not deleted.
- The cached shell is served as one version. Updates wait until the user activates
  them, preventing a new HTML page from being paired with an old cached decoder.

## Verification approach

- Synthetic fixtures are generated by the pinned Go implementation and contain only
  dummy hosts/credentials. They cover NPVT, NPVS v1/v5, app-key/passphrase modes,
  24 generation-2 vectors, and 120 CTR vectors.
- Unit tests cover wrong/missing passwords, AEAD tampering, truncation, strict
  Base64/JSON limits, redaction, safe filenames, prototype-pollution resistance,
  IPv6/REALITY/host/SNI/path semantics, and raw-only fallbacks.
- Browser tests cover worker decoding, password retry, masking, clipboard, TXT/JSON/
  ZIP exports, scoped atomic caching, offline reload and decode, explicit updates,
  theme persistence, mobile layout, and the absence of external or upload requests.
- The supplied real NPVT sample was used only for private differential validation.
  The supplied real NPVS sample was inspected structurally; its private content was
  not decrypted without the user's password and is not included in the repository.
