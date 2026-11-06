# Security policy

Maintainer: [Kourosh](https://github.com/Kourosh242).

Open NPV 0.2.x is the current series. Please report vulnerabilities through the repository's private vulnerability reporting facility once enabled, or contact the repository owner privately. Do not attach real configuration files, passwords, UUIDs, server addresses, or decrypted output to a public issue.

## Scope

- Any upload or cross-origin request containing user file data.
- XSS through filenames, remarks, creator messages, JSON, or share links.
- Incorrect AEAD/AAD/HKDF handling, silent partial output, or lossy conversion presented as complete.
- Service worker caching of user data, cross-project cache deletion, or broken offline updates.
- Path traversal in downloads/ZIP or unbounded parsing/CPU/memory use.

## Non-goals

This tool does not provide anonymity, test proxy reachability, validate server ownership, verify an unknown creator's identity, crack passphrases, or guarantee that a browser can securely erase every copy of a string. Browser extensions, clipboard managers, downloaded files, and the operating system are outside its trust boundary.

Only process files you own or are authorized to inspect. Decryption can reveal credentials. Keep extracted output private.
