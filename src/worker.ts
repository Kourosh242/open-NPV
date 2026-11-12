/// <reference lib="webworker" />
// SPDX-License-Identifier: AGPL-3.0-only
// Open NPV — All parsing, cryptography and ZIP packing stay here,
// off the main thread. Nothing in this file performs network I/O.
import { zipSync, strToU8 } from 'fflate';
import { decodeContainer } from './core/index.js';
import { DecodeError } from './core/utils.js';
import type { WorkerJob, WorkerResult } from './core/types.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WorkerJob>) => {
  const job = event.data;

  if (job.kind === 'zip') {
    try {
      const files: Record<string, Uint8Array> = {};
      for (const [name, content] of Object.entries(job.files)) files[name] = strToU8(content);
      const bytes = zipSync(files, { level: 6 });
      const ok: WorkerResult = { kind: 'zip', id: job.id, ok: true, bytes };
      scope.postMessage(ok, [bytes.buffer as ArrayBuffer]);
    } catch {
      const failed: WorkerResult = { kind: 'zip', id: job.id, ok: false, message: 'ساخت فایل ZIP ممکن نشد.' };
      scope.postMessage(failed);
    }
    return;
  }

  const { id, bytes } = job;
  let pass = job.password || '';
  let response: WorkerResult;
  try {
    const result = decodeContainer(bytes, pass);
    response = { kind: 'decode', id, ok: true, result };
  } catch (error) {
    response = {
      kind: 'decode', id, ok: false,
      code: error instanceof DecodeError ? error.code : 'FORMAT',
      message: error instanceof DecodeError ? error.message : 'پردازش این فایل ممکن نشد. فایل ممکن است خراب یا از نسخه‌ای ناسازگار باشد.',
    };
  } finally {
    bytes.fill(0);
    pass = '';
  }
  scope.postMessage(response);
};
