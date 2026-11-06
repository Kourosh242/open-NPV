import type { ContainerInfo, DecodeResult, Json } from './types.js';
import { ensure, hasMagic, object, parseJson, text } from './utils.js';
import { decodeNPVT } from './npvt.js';
import { decodeNPVS, decodeSentinels, inspectNPVS } from './npvs.js';
import { extractConfigurations } from './convert.js';
export * from './types.js';
export { DecodeError, MAX_FILE_BYTES, redact, safeFilename } from './utils.js';
export { extractConfigurations, validateShareUri } from './convert.js';

export function inspectContainer(bytes: Uint8Array): ContainerInfo {
  if (hasMagic(bytes, 'NPVT1')) return { format: 'NPVT1', version: 1, requiresPassword: false, authenticated: false };
  if (hasMagic(bytes, 'NPVS')) return inspectNPVS(bytes);
  if (hasMagic(bytes, 'NPVO1')) return { format: 'NPVO1', version: 1, requiresPassword: false, authenticated: false };
  ensure(false, 'FORMAT', 'قالب ناشناخته است. فایل سالمِ NPVT1 یا NPVS را انتخاب کنید؛ تغییر پسوند کافی نیست.');
}

export function decodeContainer(bytes: Uint8Array, password?: string): DecodeResult {
  const info = inspectContainer(bytes);
  if (info.format === 'NPVT1') return decodeNPVT(bytes);
  if (info.format === 'NPVS') return decodeNPVS(bytes, password);
  const input = text(bytes).replace(/^\uFEFF/, '').trim();
  const root = parseJson(input.slice(5).trim());
  ensure(object(root) && Array.isArray(root.configs), 'FORMAT', 'ساختار NPVO1 معتبر نیست.');
  const warnings: string[] = [];
  const configs = extractConfigurations(decodeSentinels(root.configs as Json[], warnings));
  return { format: 'NPVO1', version: 1, unlock: 'none', authenticated: false, configs, warnings };
}
