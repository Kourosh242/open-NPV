// SPDX-License-Identifier: AGPL-3.0-only
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { DecodeError, utf8 } from './utils.js';

export function open(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Uint8Array {
  try { return chacha20poly1305(key, nonce, aad).decrypt(ciphertext); }
  catch { throw new DecodeError('INTEGRITY', 'اعتبارسنجی رمزنگاری ناموفق بود؛ فایل یا کلید با این قالب سازگار نیست.'); }
}
export function passphraseKey(password: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, utf8(password), salt, { c: iterations, dkLen: 32 });
}
export function deriveFieldKey(dek: Uint8Array, salt: Uint8Array, info: string | Uint8Array): Uint8Array {
  return hkdf(sha256, dek, salt, typeof info === 'string' ? utf8(info) : info, 32);
}
