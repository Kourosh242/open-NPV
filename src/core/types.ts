export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type Protocol = 'vless' | 'vmess' | 'trojan' | 'ss' | 'ssh' | 'other';
export type UnlockMethod = 'none' | 'embedded' | 'passphrase';
export type ErrorCode = 'FORMAT' | 'TRUNCATED' | 'PASSWORD_REQUIRED' | 'BAD_PASSWORD' | 'UNSUPPORTED' | 'INTEGRITY' | 'LIMIT' | 'EMPTY';

export interface ConfigItem {
  name: string;
  protocol: Protocol;
  uri?: string;
  raw: Json;
  host?: string;
  port?: number;
  transport?: string;
  security?: string;
  warnings: string[];
}

export interface ContainerInfo {
  format: 'NPVT1' | 'NPVS' | 'NPVO1';
  version: number;
  requiresPassword: boolean;
  authenticated: boolean;
}

export interface DecodeResult {
  format: ContainerInfo['format'];
  version: number;
  unlock: UnlockMethod;
  authenticated: boolean;
  configs: ConfigItem[];
  warnings: string[];
  metadata?: JsonObject;
  fieldCount?: number;
}

/** Decode runs in the long-lived worker; ZIP runs in a short-lived one. */
export interface DecodeJob {
  kind: 'decode';
  id: number;
  bytes: Uint8Array;
  password?: string;
}
export interface ZipJob {
  kind: 'zip';
  id: number;
  files: Record<string, string>;
}
export type WorkerJob = DecodeJob | ZipJob;

export type WorkerResult =
  | { kind: 'decode'; id: number; ok: true; result: DecodeResult }
  | { kind: 'decode'; id: number; ok: false; code: ErrorCode; message: string }
  | { kind: 'zip'; id: number; ok: true; bytes: Uint8Array }
  | { kind: 'zip'; id: number; ok: false; message: string };
