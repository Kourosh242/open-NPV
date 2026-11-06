// SPDX-License-Identifier: AGPL-3.0-only
// Format and key-derivation port of Pantegnos npvs*.go. See NOTICE.
import { sha256 } from '@noble/hashes/sha256';
import type { ContainerInfo, DecodeResult, Json, JsonObject } from './types.js';
import { base64, be16, be32, concat, DecodeError, ensure, hasMagic, object, parseJson, read16, read32, text, unbase64, unique, utf8 } from './utils.js';
import { custodianKDKs, gen2A16, gen2KDK } from './whitebox.js';
import { deriveFieldKey, open, passphraseKey } from './crypto.js';
import { extractConfigurations } from './convert.js';

const MAX_ITERATIONS = 10_000_000;
interface Envelope {
  info: ContainerInfo;
  method: number;
  salt: Uint8Array;
  wrap: Uint8Array;
  iterations: number;
  configID: Uint8Array;
  prefix: Uint8Array;
  metadata: Uint8Array;
  nonce: Uint8Array;
  body: Uint8Array;
  header?: JsonObject;
}

function metadataFrom(value: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const key of ['issuedAt', 'expiresAt', 'configVersion', 'attestationLevel', 'onlyMobileNetwork']) {
    const field = value[key];
    if (typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean') result[key] = field;
  }
  return result;
}
function parseV1(bytes: Uint8Array): Envelope {
  ensure(bytes.length >= 89, 'TRUNCATED', 'پوش NPVS ناقص است.');
  const version = bytes[4]!;
  ensure(version <= 1, 'UNSUPPORTED', `نسخهٔ NPVS (${version}) پشتیبانی نمی‌شود.`);
  const length = read32(bytes, 5);
  ensure(length >= 2 && length <= 1024 * 1024 && 9 + length + 80 <= bytes.length, 'FORMAT', 'طول سربرگ NPVS معتبر نیست.');
  const headerRaw = bytes.subarray(9, 9 + length);
  const parsed = parseJson(headerRaw);
  ensure(object(parsed), 'FORMAT', 'سربرگ NPVS باید یک شیء JSON باشد.');
  const header = parsed;
  const app = object(header.appKey) ? header.appKey : undefined;
  const pass = object(header.passphrase) ? header.passphrase : undefined;
  ensure(app || pass || Array.isArray(header.recipients), 'UNSUPPORTED', 'روش باز کردن این NPVS پشتیبانی نمی‌شود.');
  const wrapObject = app || pass;
  const salt = wrapObject ? unbase64(String(wrapObject.salt || '')) : new Uint8Array();
  const wrap = wrapObject ? unbase64(String(wrapObject.wrap || '')) : new Uint8Array();
  const nonceOffset = 9 + length;
  const nonce = bytes.subarray(nonceOffset, nonceOffset + 12);
  const bodyLength = read32(bytes, nonceOffset + 12);
  const bodyStart = nonceOffset + 16;
  ensure(bodyLength >= 16 && bodyStart + bodyLength + 64 === bytes.length, 'FORMAT', 'طول بدنهٔ NPVS معتبر نیست.');
  return {
    info: { format: 'NPVS', version, requiresPassword: !app && !!pass, authenticated: true },
    method: app ? 2 : pass ? 1 : 0, salt, wrap, iterations: pass ? Number(pass.iters) : 0,
    configID: new Uint8Array(), prefix: headerRaw, metadata: new Uint8Array(), nonce,
    body: bytes.subarray(bodyStart, bodyStart + bodyLength), header,
  };
}

function parseV5(bytes: Uint8Array): Envelope {
  ensure(bytes.length >= 9 + 135 + 16 + 32 + 64, 'TRUNCATED', 'پوش NPVS نسخهٔ ۵ ناقص است.');
  const length = read32(bytes, 5);
  ensure(length >= 135 && length <= 1024 * 1024 && 9 + length + 80 <= bytes.length, 'FORMAT', 'طول سربرگ NPVS معتبر نیست.');
  const h = bytes.subarray(9, 9 + length);
  ensure(h[0] === 1, 'UNSUPPORTED', 'نسخهٔ سربرگ فشردهٔ NPVS پشتیبانی نمی‌شود.');
  const method = h[50]!;
  ensure(method >= 0 && method <= 2, 'UNSUPPORTED', 'روش باز کردن NPVS ناشناخته است.');
  const recipients = read16(h, 51);
  ensure(recipients <= 1024 && (method !== 0 || recipients > 0), 'FORMAT', 'تعداد گیرندگان NPVS معتبر نیست.');
  let offset = 53 + recipients * (32 + 0x5d);
  let salt = new Uint8Array(), wrap = new Uint8Array(), iterations = 0;
  if (method === 1) {
    ensure(offset + 84 <= h.length, 'TRUNCATED', 'بلوک گذرواژه ناقص است.');
    iterations = read32(h, offset);
    ensure(Number.isInteger(iterations) && iterations >= 1 && iterations <= MAX_ITERATIONS, 'LIMIT', 'تعداد تکرار KDF خارج از محدودهٔ مجاز است.');
    salt = h.slice(offset + 4, offset + 20); wrap = h.slice(offset + 20, offset + 80); offset += 80;
  } else if (method === 2) {
    ensure(offset + 82 <= h.length && read16(h, offset) === 2, 'FORMAT', 'بلوک کلید برنامه موجود نیست.');
    salt = h.slice(offset + 2, offset + 18); wrap = h.slice(offset + 18, offset + 78); offset += 78;
  }
  ensure(offset + 4 <= h.length, 'TRUNCATED', 'طول متادیتا موجود نیست.');
  const metaLength = read32(h, offset);
  ensure(metaLength >= 16 && offset + 4 + metaLength === h.length, 'FORMAT', 'طول متادیتا معتبر نیست.');
  const metadata = h.slice(offset + 4);
  const prefix = h.subarray(0, offset);
  const start = 9 + length;
  const nonce = bytes.subarray(start, start + 12);
  const bodyLength = read32(bytes, start + 12);
  ensure(bodyLength >= 32 && start + 16 + bodyLength + 64 === bytes.length, 'FORMAT', 'طول بدنهٔ NPVS معتبر نیست.');
  return {
    info: { format: 'NPVS', version: 5, requiresPassword: method === 1, authenticated: true },
    method, salt, wrap, iterations, configID: h.slice(1, 17), prefix, metadata, nonce,
    body: bytes.subarray(start + 16, start + 16 + bodyLength),
  };
}

export function inspectNPVS(bytes: Uint8Array): ContainerInfo {
  return (bytes[4] === 5 ? parseV5(bytes) : parseV1(bytes)).info;
}
function checkPassword(password: string | undefined, required: boolean): string {
  ensure(!required || !!password, 'PASSWORD_REQUIRED', 'این فایل گذرواژه دارد؛ گذرواژه را در همین دستگاه وارد کنید.');
  const value = password || '';
  ensure(value.length <= 4096, 'LIMIT', 'گذرواژه بیش از حد طولانی است.');
  return value;
}
function unwrap(envelope: Envelope, password: string): Uint8Array {
  ensure(envelope.method !== 0, 'UNSUPPORTED', 'این فایل به کلید خصوصی گیرنده نیاز دارد و با گذرواژه باز نمی‌شود.');
  ensure(envelope.salt.length === 16 && envelope.wrap.length === 60, 'FORMAT', 'اندازهٔ کلید یا salt معتبر نیست.');
  if (envelope.method === 1) {
    ensure(Number.isInteger(envelope.iterations) && envelope.iterations >= 1 && envelope.iterations <= MAX_ITERATIONS, 'LIMIT', 'تعداد تکرار KDF خارج از محدودهٔ مجاز است.');
    if (envelope.info.version !== 5) ensure(object(envelope.header?.passphrase ?? null) && (envelope.header!.passphrase as JsonObject).kdf === 'pbkdf2-hmac-sha256', 'UNSUPPORTED', 'الگوریتم گذرواژه پشتیبانی نمی‌شود.');
    const key = passphraseKey(password, envelope.salt, envelope.iterations);
    try { return open(key, envelope.wrap.subarray(0, 12), envelope.wrap.subarray(12), envelope.salt); }
    catch { throw new DecodeError('BAD_PASSWORD', 'گذرواژه نادرست است، یا بلوک کلید فایل آسیب دیده است.'); }
    finally { key.fill(0); }
  }
  if (envelope.info.version === 5) {
    const key = gen2KDK(gen2A16(envelope.salt), envelope.configID);
    try { return open(key, envelope.wrap.subarray(0, 12), envelope.wrap.subarray(12), envelope.salt); }
    catch { throw new DecodeError('UNSUPPORTED', 'کلید برنامهٔ این نسخه شناسایی نشد؛ فایل ممکن است از نسخهٔ جدیدتری باشد.'); }
    finally { key.fill(0); }
  }
  const app = envelope.header?.appKey;
  ensure(object(app) && app.kdf === 'wbaes-ctr-sha256' && app.keyId === 1, 'UNSUPPORTED', 'این نسخهٔ کلید برنامه پشتیبانی نمی‌شود.');
  for (const key of custodianKDKs(envelope.salt)) {
    try { return open(key, envelope.wrap.subarray(0, 12), envelope.wrap.subarray(12), envelope.salt); }
    catch { /* Try the next documented format variant. */ }
    finally { key.fill(0); }
  }
  throw new DecodeError('UNSUPPORTED', 'هیچ کلید برنامهٔ سازگاری با این فایل پیدا نشد.');
}

export function decodeSentinels(value: Json, warnings: string[]): Json {
  if (Array.isArray(value)) return value.map(v => decodeSentinels(v, warnings));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeSentinels(v, warnings)]));
  if (typeof value !== 'string') return value;
  return value.replace(/npvs1:([A-Za-z0-9+/_=-]*)/g, (whole, token: string) => {
    try { return text(unbase64(token)); }
    catch { warnings.push('یک نشانگر npvs1 قابل دیکود نبود و بدون تغییر در JSON باقی ماند.'); return whole; }
  });
}
function fieldText(bytes: Uint8Array): string {
  const value = text(bytes).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { const parsed = parseJson(value); if (typeof parsed === 'string') return parsed; } catch { /* Preserve raw field text. */ }
  }
  return value;
}
function substitute(value: Json, fields: Map<number, Uint8Array>, warnings: string[]): Json {
  if (typeof value === 'number') {
    ensure(Number.isInteger(value) && value >= 0 && value < 65535 && fields.has(value), 'FORMAT', `مرجع فیلد ${value} در جدول وجود ندارد.`);
    return decodeSentinels(fieldText(fields.get(value)!), warnings);
  }
  if (Array.isArray(value)) return value.map(v => substitute(v, fields, warnings));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, fields, warnings)]));
  return decodeSentinels(value, warnings);
}
function parseFields(body: Uint8Array): { contentID: Uint8Array; rows: Array<{ seq: number; flags: number; blob: Uint8Array }> } {
  ensure(body.length >= 38 && hasMagic(body, 'NPF\u0001'), 'FORMAT', 'شناسهٔ جدول فیلدهای NPF معتبر نیست.');
  const count = read16(body, 36);
  ensure(count <= 10000, 'LIMIT', 'تعداد فیلدها بیش از حد مجاز است.');
  const rows: Array<{ seq: number; flags: number; blob: Uint8Array }> = [];
  const seen = new Set<number>();
  let offset = 38;
  for (let i = 0; i < count; i++) {
    ensure(offset + 6 <= body.length, 'TRUNCATED', 'سربرگ فیلد NPF ناقص است.');
    const seq = read16(body, offset), flags = read16(body, offset + 2), length = read16(body, offset + 4);
    ensure(length >= 16 && offset + 6 + length <= body.length && !seen.has(seq), 'FORMAT', 'رکورد فیلد NPF معتبر نیست.');
    seen.add(seq);
    rows.push({ seq, flags, blob: body.subarray(offset + 6, offset + 6 + length) });
    offset += 6 + length;
  }
  ensure(offset === body.length, 'FORMAT', 'دادهٔ اضافی در جدول فیلدها وجود دارد.');
  return { contentID: body.subarray(4, 36), rows };
}

export function decodeNPVS(bytes: Uint8Array, password?: string): DecodeResult {
  const envelope = bytes[4] === 5 ? parseV5(bytes) : parseV1(bytes);
  const pass = checkPassword(password, envelope.info.requiresPassword);
  ensure(envelope.method !== 0, 'UNSUPPORTED', 'باز کردن پوش گیرنده‌محور به کلید خصوصی گیرنده نیاز دارد.');
  const dek = unwrap(envelope, pass);
  try {
    const warnings: string[] = [];
    let configsRoot: Json;
    let metadata: JsonObject = {};
    let fieldCount: number | undefined;
    if (envelope.info.version === 5) {
      const metaKey = deriveFieldKey(dek, envelope.nonce, 'NPVS-v5/metadata');
      const metadataText = open(metaKey, envelope.nonce, envelope.metadata, envelope.prefix);
      metaKey.fill(0);
      const meta = parseJson(metadataText);
      if (object(meta)) {
        metadata = metadataFrom(object(meta.policy) ? { ...meta, ...meta.policy } : meta);
      }
      const { contentID, rows } = parseFields(envelope.body);
      const fields = new Map<number, Uint8Array>();
      for (const row of rows) {
        ensure(row.flags === 0, 'UNSUPPORTED', 'پرچم فیلد ناشناخته است؛ از تبدیل ناقص خودداری شد.');
        const key = deriveFieldKey(dek, contentID, concat(utf8('NPV-fields-v1/field/'), be16(row.seq)));
        const aad = concat(utf8('NPV-fields-v1/record/'), contentID, be16(row.seq), be32(row.blob.length - 16));
        try { fields.set(row.seq, open(key, new Uint8Array(12), row.blob, aad)); }
        catch { throw new DecodeError('INTEGRITY', `اعتبارسنجی فیلد ${row.seq} ناموفق بود؛ خروجی ناقص ارائه نمی‌شود.`); }
        finally { key.fill(0); }
      }
      fieldCount = fields.size;
      ensure(fields.has(65535), 'FORMAT', 'جدول کانفیگ‌های NPVS موجود نیست.');
      const table = parseJson(fields.get(65535)!);
      ensure(object(table) && Array.isArray(table.configs), 'FORMAT', 'فهرست کانفیگ‌های NPVS معتبر نیست.');
      configsRoot = substitute(table.configs, fields, warnings);
    } else {
      const plaintext = open(dek, envelope.nonce, envelope.body, envelope.prefix);
      configsRoot = decodeSentinels(parseJson(plaintext), warnings);
      if (object(envelope.header) && object(envelope.header.policy)) metadata = metadataFrom(envelope.header.policy);
    }
    return {
      format: 'NPVS', version: envelope.info.version, unlock: envelope.method === 1 ? 'passphrase' : 'embedded', authenticated: true,
      configs: extractConfigurations(configsRoot), warnings: unique(warnings), metadata,
      ...(fieldCount === undefined ? {} : { fieldCount }),
    };
  } finally { dek.fill(0); }
}

