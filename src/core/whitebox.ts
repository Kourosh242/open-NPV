// SPDX-License-Identifier: AGPL-3.0-only
// TypeScript port of Pantegnos npvt.go, npvs_wb.go and npvs_gen2_wb.go.
// Upstream pin and attribution: vendor/pantegnos/provenance.json.
import { unzlibSync } from 'fflate';
import { sha256 } from '@noble/hashes/sha256';
import * as T from '../generated/tables.js';
import { concat, ensure, unbase64, utf8 } from './utils.js';

const shiftOrder = [0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12, 1, 6, 11] as const;
const tyRaw = unbase64(T.tyboxes_bin);
const mblRaw = unbase64(T.mbl_bin);
const xor = unbase64(T.xor_bin);
const lastNPVT = unbase64(T.npvt_last_bin);
const lastV1 = unbase64(T.tboxes_last_bin);
const lastV2 = unbase64(T.tboxes_last_v2_bin);
let gen2Tables: Uint8Array | undefined;

function word(table: Uint8Array, index: number): number {
  const offset = index * 4;
  return ((table[offset]! << 24) | (table[offset + 1]! << 16) | (table[offset + 2]! << 8) | table[offset + 3]!) >>> 0;
}
function shift(state: Uint8Array): void {
  const old = state.slice();
  for (let i = 0; i < 16; i++) state[i] = old[shiftOrder[i]!]!;
}
function mix(group: number, k: number, a: number, b: number, c: number, d: number): number {
  const t = group * 24 + k * 6;
  const hi = 28 - 8 * k;
  const lo = 24 - 8 * k;
  const at = (n: number, x: number, y: number) => xor[(n << 8) + (x << 4) + y]!;
  const p1 = at(t, (a >>> hi) & 15, (b >>> hi) & 15);
  const p2 = at(t + 1, (c >>> hi) & 15, (d >>> hi) & 15);
  const p3 = at(t + 2, (a >>> lo) & 15, (b >>> lo) & 15);
  const p4 = at(t + 3, (c >>> lo) & 15, (d >>> lo) & 15);
  return (at(t + 4, p1, p2) << 4) | at(t + 5, p3, p4);
}
function applyRow(state: Uint8Array, base: number, table: Uint8Array, group: number): void {
  const a = word(table, (base << 8) + state[base]!);
  const b = word(table, ((base + 1) << 8) + state[base + 1]!);
  const c = word(table, ((base + 2) << 8) + state[base + 2]!);
  const d = word(table, ((base + 3) << 8) + state[base + 3]!);
  for (let k = 0; k < 4; k++) state[base + k] = mix(group, k, a, b, c, d);
}
function block(input: Uint8Array, last: Uint8Array): Uint8Array {
  const state = input.slice(0, 16);
  shift(state);
  for (let group = 0; group < 4; group++) {
    applyRow(state, group * 4, tyRaw, group);
    applyRow(state, group * 4, mblRaw, group);
  }
  shift(state);
  for (let i = 0; i < 16; i++) state[i] = last[i * 256 + state[i]!]!;
  return state;
}

/** The format uses a 128-bit big-endian counter, not standard 32-bit AES-CTR. */
export function whiteboxCTR(nonce: Uint8Array, data: Uint8Array, variant: 'npvt' | 'v1' | 'v2' = 'npvt'): Uint8Array {
  ensure(nonce.length === 16, 'FORMAT', 'طول شمارنده باید ۱۶ بایت باشد.');
  const last = variant === 'npvt' ? lastNPVT : variant === 'v1' ? lastV1 : lastV2;
  const counter = nonce.slice();
  const out = new Uint8Array(data.length);
  for (let offset = 0; offset < data.length; offset += 16) {
    const stream = block(counter, last);
    const length = Math.min(16, data.length - offset);
    for (let i = 0; i < length; i++) out[offset + i] = data[offset + i]! ^ stream[i]!;
    for (let p = 15; p >= 0; p--) { counter[p] = (counter[p]! + 1) & 255; if (counter[p] !== 0) break; }
  }
  return out;
}

export function custodianKDKs(salt: Uint8Array): Uint8Array[] {
  ensure(salt.length === 16, 'FORMAT', 'طول salt باید ۱۶ بایت باشد.');
  const material = new Uint8Array(32);
  material.set(salt);
  return (['v1', 'v2'] as const).map(variant => {
    const stream = whiteboxCTR(material.subarray(0, 16), material.subarray(16), variant);
    return sha256(concat(utf8('npvtunnel/appkey/v1 '), stream));
  });
}

// Direct arithmetic port of the 13-round gen-2 network. All arithmetic is
// explicitly reduced to uint32; table reads remain inside the current block.
function gen2Group(state: Uint8Array, data: Uint8Array, j: number): void {
  const s = state.subarray(j * 4, j * 4 + 4);
  for (const half of [0x6000, 0xa000]) {
    const base = half + 0x1000 * j;
    const args = [0, 1, 2, 3].map(k => word(data, (base + k * 0x400) / 4 + s[k]!));
    s.set(gen2Sub(j, args[0]!, args[1]!, args[2]!, args[3]!, data));
  }
}
function gen2Sub(i: number, x3: number, x4: number, x5: number, x6: number, data: Uint8Array): Uint8Array {
  // Keep upstream instruction order: temporaries are intentionally reused.
  const m = (v: number) => v >>> 0;
  const at = (offset: number) => data[offset]!;
  const out = new Uint8Array(4);
  let x0 = 0, x8 = 0, x9 = 0, x10 = 0, x11 = 0, x12 = 0, x13 = 0;
  let x14 = 0, x15 = 0, x16 = 0, x17 = 0;
  const x2 = i;
  x8 = m(x2 + m(x2 << 1));
  x12 = m(x3 >>> 20); x11 = m(x3 >>> 24);
  x13 = (x4 >>> 24) & 15; x14 = m(x5 >>> 24); x10 = x6;
  x9 = m(x8 << 3); x8 = x4;
  x12 &= 0xf0; x12 += x13;
  x13 = m(x5 >>> 20); x16 = x8 >>> 28;
  x9 &= 0xffffffff; x11 &= 0xf0; x14 &= 0xf0;
  x15 = m(x6 >>> 24) & 15; x13 &= 0xf0; x17 = m(x3 >>> 16);
  x9 = m(x9 << 8); x8 &= 15; x13 += x15; x17 &= 0xf0;
  x11 = x9 + x11; x14 = x9 + x14; x12 = x9 + x12;
  x16 = at(x11 + x16); x14 += x10 >>> 28;
  x12 = at(x12 + 0x200); x13 = x9 + x13;
  x0 = m(x6 >>> 20) & 15; x14 = at(x14 + 0x100);
  x15 = x9 + (x16 << 4); x13 = at(x13 + 0x300);
  x12 = x9 + (x12 << 4); x16 = m(x4 >>> 20) & 15; x10 &= 15;
  x14 = x15 + x14; x15 = m(x5 >>> 16); x12 += x13;
  x13 = m(x3 >>> 12); x14 = at(x14 + 0x400); x12 = at(x12 + 0x500);
  x15 &= 0xf0; x16 = x17 + x16; x15 += x0;
  x0 = m(x4 >>> 16) & 15; x17 = m(x5 >>> 12);
  x12 |= x14 << 4; x13 &= 0xf0; x14 = m(x6 >>> 16) & 15;
  x13 += x0; x17 &= 0xf0; x16 = x9 + x16; out[0] = x12;
  x13 = x9 + x13; x12 = x17 + x14; x14 = at(x16 + 0x600);
  x13 = at(x13 + 0x800); x15 = x9 + x15; x12 = x9 + x12;
  x15 = at(x15 + 0x700); x16 = m(x5 >>> 8); x12 = at(x12 + 0x900);
  x14 = x9 + (x14 << 4); x13 = x9 + (x13 << 4);
  x0 = m(x6 >>> 12) & 15; x17 = m(x3 >>> 8);
  x14 += x15; x12 = x13 + x12; x13 = x16 & 0xf0;
  x14 = at(x14 + 0xa00); x12 = at(x12 + 0xb00);
  x15 = m(x3 >>> 4); x13 += x0; x0 = m(x4 >>> 8) & 15;
  x16 = m(x4 >>> 12) & 15; x12 |= x14 << 4;
  x14 = x15 & 0xf0; x17 &= 0xf0; x14 += x0;
  x15 = x9 + 0xc00; x0 = m(x5 >>> 4); x17 = x15 + x17; out[1] = x12;
  x12 = m(x6 >>> 8) & 15; x16 = at(x17 + x16);
  x14 = x9 + x14; x17 = x0 & 0xf0; x14 = at(x14 + 0xe00);
  x12 = x17 + x12; x13 = x15 + x13; x12 = x9 + x12;
  x13 = at(x13 + 0x100); x15 = x9 + (x16 << 4); x12 = at(x12 + 0xf00);
  x14 = x9 + (x14 << 4); x16 = 0x1000; x13 = x15 + x13;
  x17 = m(x6 >>> 4) & 15; x0 = x5 & 0xf0; x12 = x14 + x12;
  x14 = 0x1100; x13 = at(x13 + x16); x12 = at(x12 + x14);
  x14 = 0x1200; x15 = m(x4 >>> 4) & 15; x16 = x3 & 0xf0;
  x17 = x0 + x17; x14 = x9 + x14; x12 |= x13 << 4;
  x13 = (x3 & 15) << 4; x16 = x14 + x16; out[2] = x12;
  x8 = x13 + x8; x12 = x14 + x17; x14 = (x5 & 15) << 4;
  x13 = at(x16 + x15); x8 = x9 + x8; x15 = 0x1400;
  x12 = at(x12 + 0x100); x8 = at(x8 + x15);
  x10 = x14 + x10; x14 = 0x1500; x10 = x9 + x10;
  x13 = x9 + (x13 << 4); x10 = at(x10 + x14);
  x8 = x9 + (x8 << 4); x9 = x13 + x12; x12 = 0x1600;
  x8 += x10; x10 = 0x1700; x9 = at(x9 + x12); x8 = at(x8 + x10);
  out[3] = x8 | (x9 << 4);
  return out;
}

export function gen2A16(salt: Uint8Array): Uint8Array {
  ensure(salt.length === 16, 'FORMAT', 'طول salt باید ۱۶ بایت باشد.');
  if (!gen2Tables) {
    gen2Tables = unzlibSync(unbase64(T.gen2_tables_bin_z));
    ensure(gen2Tables.length === 13 * 57344 + 4096, 'FORMAT', 'جدول‌های قالب معتبر نیستند.');
  }
  const state = salt.slice();
  for (let round = 0; round < 13; round++) {
    const data = gen2Tables.subarray(round * 57344, (round + 1) * 57344);
    shift(state);
    for (let j = 0; j < 4; j++) gen2Group(state, data, j);
  }
  const page = gen2Tables.subarray(13 * 57344);
  return Uint8Array.from({ length: 16 }, (_, i) => page[0x100 * i + state[shiftOrder[i]!]!]!);
}
export function gen2KDK(a16: Uint8Array, configID: Uint8Array): Uint8Array {
  return sha256(concat(utf8('npvtunnel/appkey/v2 '), a16, configID));
}
