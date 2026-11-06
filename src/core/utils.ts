import type { ErrorCode, Json, JsonObject } from './types.js';

export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_CONFIGS = 2048;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class DecodeError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

export function ensure(condition: unknown, code: ErrorCode, message: string): asserts condition {
  if (!condition) throw new DecodeError(code, message);
}

export function utf8(value: string): Uint8Array { return encoder.encode(value); }
export function text(bytes: Uint8Array): string {
  try { return decoder.decode(bytes); }
  catch { throw new DecodeError('FORMAT', 'محتوای فایل پس از بازگشایی، UTF-8 معتبر نیست.'); }
}
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
export function be16(value: number): Uint8Array { return new Uint8Array([value >>> 8, value]); }
export function be32(value: number): Uint8Array { return new Uint8Array([value >>> 24, value >>> 16, value >>> 8, value]); }
export function read16(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 8) | bytes[offset + 1]!; }
export function read32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}
export function hasMagic(bytes: Uint8Array, magic: string): boolean {
  const m = utf8(magic);
  return bytes.length >= m.length && m.every((b, i) => bytes[i] === b);
}

export function base64(bytes: Uint8Array, urlSafe = false): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const value = btoa(binary);
  return urlSafe ? value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : value;
}

export function unbase64(input: string): Uint8Array {
  const s = input.replace(/\s/g, '');
  ensure(s.length > 0 && s.length <= MAX_FILE_BYTES * 2, 'LIMIT', 'دادهٔ Base64 بیش از حد بزرگ است.');
  ensure(/^[A-Za-z0-9+/_-]*={0,2}$/.test(s), 'FORMAT', 'Base64 معتبر نیست.');
  ensure(!(/[+/]/.test(s) && /[-_]/.test(s)), 'FORMAT', 'الفبای Base64 مخلوط است.');
  const raw = s.replace(/=+$/, '');
  ensure(raw.length % 4 !== 1, 'FORMAT', 'طول Base64 معتبر نیست.');
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    ensure(base64(bytes).replace(/=+$/, '') === normalized, 'FORMAT', 'Base64 غیرمتعارف است.');
    return bytes;
  } catch (error) {
    if (error instanceof DecodeError) throw error;
    throw new DecodeError('FORMAT', 'Base64 معتبر نیست.');
  }
}

export function parseJson(input: string | Uint8Array): Json {
  ensure(input.length <= MAX_FILE_BYTES * 2, 'LIMIT', 'JSON بیش از حد بزرگ است.');
  let root: Json;
  try { root = JSON.parse(typeof input === 'string' ? input : text(input)) as Json; }
  catch (error) {
    if (error instanceof DecodeError) throw error;
    throw new DecodeError('FORMAT', 'ساختار JSON فایل معتبر نیست.');
  }
  const stack: Array<[Json, number]> = [[root, 0]];
  let count = 0;
  while (stack.length) {
    const [value, depth] = stack.pop()!;
    ensure(++count <= 150000 && depth <= 96, 'LIMIT', 'پیچیدگی JSON از حد مجاز بیشتر است.');
    if (Array.isArray(value)) for (const child of value) stack.push([child, depth + 1]);
    else if (object(value)) for (const child of Object.values(value)) stack.push([child, depth + 1]);
  }
  return root;
}

export function object(value: Json | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function str(value: Json | undefined): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return '';
}
export function integer(value: Json | undefined): number {
  const s = str(value).trim();
  return /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : 0;
}
export function truthy(value: Json | undefined): boolean {
  return typeof value === 'boolean' ? value : ['true', '1', 'yes'].includes(str(value).toLowerCase());
}
export function port(value: Json | undefined): number {
  const n = integer(value);
  ensure(n >= 1 && n <= 65535, 'FORMAT', 'شمارهٔ پورت معتبر نیست.');
  return n;
}
export function unique(values: string[]): string[] { return [...new Set(values)]; }

const secretKey = /^(password|passwd|pwd|id|uuid|secret|private.?key|short.?id|seed|ssh.?password|ssh.?username|username|auth|psk|token)$/i;
const shareUri = /^(vless|vmess|trojan|ss):\/\//i;
function redactUri(uri: string): string {
  const scheme = uri.split(':')[0]!.toLowerCase();
  if (scheme === 'vmess' || scheme === 'ss') return `${scheme}://••••••••••••••••••••••••`;
  try {
    const masked = uri.replace(/\/\/[^/@]+@/, '//••••••••@');
    const url = new URL(masked);
    for (const key of ['sid', 'password', 'secret', 'token', 'pqv', 'ech']) if (url.searchParams.has(key)) url.searchParams.set(key, '••••');
    return url.toString().replace(/%E2%80%A2/gi, '•');
  } catch { return `${scheme}://••••••••••••••••••••••••`; }
}
export function redact(value: Json): Json {
  if (Array.isArray(value)) return value.map(redact);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, secretKey.test(k) && v !== '' && v !== null ? '••••••••' : redact(v)]));
  if (typeof value === 'string' && shareUri.test(value)) return redactUri(value);
  return value;
}

export function safeFilename(name: string): string {
  const stem = name.replace(/^.*[\\/]/, '').replace(/\.(npvt|npvs)$/i, '')
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/g, '_').replace(/^\.+|\.+$/g, '').trim().slice(0, 100);
  return stem || 'config';
}
