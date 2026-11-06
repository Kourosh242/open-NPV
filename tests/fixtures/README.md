# Synthetic differential fixtures

These files contain **no real servers, credentials, or user configuration files**. All hosts use `example.invalid`, documentation IP ranges, or dummy keys. Passwords visible in the tests are public test values only.

Generated with the pinned Go implementation of Pantegnos, commit `1bb2a6743e6d1dc85e9d5e38edad68975ad1fc37`, using `../reference/generate.go`. The TypeScript implementation must reproduce the decoded JSON and all 144 white-box/CTR vectors. NPVS v5 signatures in these fixtures are intentionally zero: the extractor authenticates ChaCha20-Poly1305 tags, but does not claim to verify an unknown creator's Ed25519 identity.

To regenerate, place `generate.go` as `internal/modules/impl/zz_npvopen_fixture_test.go` in that upstream checkout, then run:

```sh
OPENNPV_FIXTURE_OUT=/absolute/path/to/tests/fixtures go test ./internal/modules/impl -run TestGenerateOpenNPVFixtures -count=1 -v
```

Never put private samples or decrypted private samples in this directory.