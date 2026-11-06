// SPDX-License-Identifier: AGPL-3.0-only
import type { DecodeResult } from './types.js';
import { ensure, object, parseJson, text, unbase64, unique } from './utils.js';
import { whiteboxCTR } from './whitebox.js';
import { extractConfigurations } from './convert.js';

function decodeToken(token: string): Uint8Array {
  const value = token.trim();
  if (value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value)) {
    return Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16));
  }
  return unbase64(value);
}

export function decodeNPVT(bytes: Uint8Array): DecodeResult {
  const input = text(bytes).replace(/^\uFEFF/, '').trim();
  ensure(input.startsWith('NPVT1'), 'FORMAT', 'شناسهٔ NPVT1 در ابتدای فایل موجود نیست.');
  const body = input.slice(5).trim();
  ensure(body.length > 0, 'EMPTY', 'فایل NPVT خالی است.');
  const tokens = body.split(',');
  ensure(tokens.length <= 4096, 'LIMIT', 'تعداد بلوک‌های NPVT بیش از حد مجاز است.');
  const configs: DecodeResult['configs'] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const blob = decodeToken(token);
    ensure(blob.length >= 17, 'TRUNCATED', 'بلوک NPVT باید شامل شمارنده و داده باشد.');
    const plaintext = whiteboxCTR(blob.subarray(0, 16), blob.subarray(16), 'npvt');
    const root = parseJson(plaintext);
    // NPVT1 also carries a scalar count and a lock-policy object. These are
    // container metadata, not extra proxy configurations.
    if (root === null || typeof root !== 'object') continue;
    const lockMetadata = !Array.isArray(root) && object(root)
      && (Object.hasOwn(root, 'isLocked') || Object.hasOwn(root, 'blockRootedAndJailbroken'))
      && !['v2rayProfile', 'outbounds', 'configType', 'sshConfig', 'v2rayJson'].some(key => Object.hasOwn(root, key));
    if (lockMetadata) continue;
    const parsed = extractConfigurations(root);
    for (const config of parsed) {
      const key = config.uri || JSON.stringify(config.raw);
      if (!seen.has(key)) { seen.add(key); configs.push(config); }
    }
    ensure(configs.length <= 2048, 'LIMIT', 'تعداد کانفیگ‌ها بیش از حد مجاز است.');
  }
  ensure(configs.length > 0, 'EMPTY', 'کانفیگی داخل فایل پیدا نشد.');
  return {
    format: 'NPVT1', version: 1, unlock: 'none', authenticated: false, configs,
    warnings: unique(['NPVT1 اصالت‌سنجی رمزنگاری‌شده ندارد؛ ساختار و JSON بررسی شده، اما سالم بودن سرور یا اصالت فایل تضمین نمی‌شود.']),
  };
}
