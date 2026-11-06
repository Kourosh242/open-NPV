// Open NPV — AGPL-3.0-only
// UI layer. No network calls except same-origin application assets and the
// bundled synthetic demo. Files, passphrases and results never leave this page.
import type { ConfigItem, DecodeResult, WorkerResult } from './core/types.js';
import { MAX_FILE_BYTES, redact, safeFilename } from './core/utils.js';

type EntryStatus = 'queued' | 'working' | 'locked' | 'done' | 'error';
interface Entry {
  id: number; name: string; size: number; status: EntryStatus;
  file?: File; bytes?: Uint8Array; result?: DecodeResult;
  message?: string; code?: string; duration?: number; rendered: number;
}
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const entries: Entry[] = [];
const MAX_FILES = 20, MAX_TOTAL_BYTES = 64 * 1024 * 1024, CHUNK = 40;
const PROTOCOL_LABEL: Record<string, string> = { vless: 'VLESS', vmess: 'VMESS', trojan: 'TROJAN', ss: 'Shadowsocks', ssh: 'SSH', other: 'سایر' };

let nextId = 1;
let worker: Worker | null = null, zipWorker: Worker | null = null;
let currentId: number | null = null;
let jobTimer: ReturnType<typeof setTimeout> | undefined;
let zipTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let reveal = false, offlineReady = false, protocolFilter = 'all';
let installPrompt: InstallPrompt | null = null;
let zipBusy = false;
let pendingRegistration: ServiceWorkerRegistration | null = null;

/* ---------------- small helpers ---------------- */

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function icon(name: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function button(label: string, symbol: string, className = 'button small ghost'): HTMLButtonElement {
  const b = h('button', className); b.type = 'button';
  b.append(icon(symbol), h('span', 'btn-label', label));
  return b;
}
function badge(label: string, className = 'badge'): HTMLSpanElement { return h('span', className, label); }
function faDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
}
function faNum(value: number): string { return faDigits(value.toLocaleString('en-US')); }
function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${faDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${faDigits((bytes / 1024).toFixed(1))} کیلوبایت`;
  return `${faDigits((bytes / 1024 / 1024).toFixed(1))} مگابایت`;
}
function announce(message: string): void { $('sr-status').textContent = message; }
function toast(message: string, kind: 'success' | 'error' | 'info' = 'info'): void {
  clearTimeout(toastTimer);
  const node = $('toast');
  node.className = `toast ${kind}`;
  node.replaceChildren(icon(kind === 'success' ? 'check-circle' : kind === 'error' ? 'alert' : 'info'), h('span', '', message));
  node.classList.add('visible');
  announce(message);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 4200);
}
function flashDone(btn: HTMLButtonElement, text = 'کپی شد'): void {
  const label = btn.querySelector<HTMLElement>('.btn-label');
  const use = btn.querySelector('use');
  if (!label) return;
  const previous = label.textContent, previousHref = use?.getAttribute('href');
  label.textContent = text; use?.setAttribute('href', '#i-check'); btn.classList.add('is-done');
  setTimeout(() => {
    label.textContent = previous;
    if (previousHref) use?.setAttribute('href', previousHref);
    btn.classList.remove('is-done');
  }, 1700);
}

/* ---------------- masking ---------------- */

function maskUri(uri: string): string {
  if (/^(vmess|ss):\/\//i.test(uri)) return `${uri.split(':')[0]}://••••••••••••••••••••••••`;
  try {
    const masked = uri.replace(/\/\/[^/@]+@/, '//••••••••@');
    const url = new URL(masked);
    for (const key of ['sid', 'password', 'secret', 'token', 'pqv', 'ech']) if (url.searchParams.has(key)) url.searchParams.set(key, '••••');
    return url.toString().replace(/%E2%80%A2/gi, '•');
  } catch { return '••••••••••••••••••••••••'; }
}
function jsonText(config: ConfigItem): string { return JSON.stringify(config.raw, null, 2); }
/**
 * Browsers may discard a non-ASCII `download` filename entirely (Chromium falls
 * back to an extension-less "download"), so file names on disk stay ASCII while
 * the Persian original is preserved in the UI and in report.json.
 */
function asciiStem(name: string): string {
  const base = safeFilename(name)
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return base || 'config';
}

/* ---------------- selection + filtering ---------------- */

function allConfigs(): Array<{ entry: Entry; config: ConfigItem; index: number }> {
  return entries.flatMap(entry => (entry.result?.configs || []).map((config, index) => ({ entry, config, index })));
}
function matchesFilter(config: ConfigItem, query: string): boolean {
  if (protocolFilter !== 'all' && config.protocol !== protocolFilter) return false;
  if (!query) return true;
  return `${config.name} ${config.protocol} ${config.host || ''} ${config.transport || ''} ${config.security || ''}`.toLowerCase().includes(query);
}
function visibleConfigs(): Array<{ entry: Entry; config: ConfigItem; index: number }> {
  const query = $<HTMLInputElement>('search-input').value.trim().toLowerCase();
  return allConfigs().filter(item => matchesFilter(item.config, query));
}
function filterActive(): boolean {
  return protocolFilter !== 'all' || $<HTMLInputElement>('search-input').value.trim() !== '';
}

function renderProtocolFilters(): void {
  const counts = new Map<string, number>();
  for (const { config } of allConfigs()) counts.set(config.protocol, (counts.get(config.protocol) || 0) + 1);
  if (protocolFilter !== 'all' && !counts.has(protocolFilter)) protocolFilter = 'all';
  const host = $('protocol-filters');
  host.replaceChildren();
  if (counts.size < 2) { host.hidden = true; return; }
  host.hidden = false;
  const add = (key: string, label: string, count: number) => {
    const chip = h('button', 'chip'); chip.type = 'button';
    chip.dataset.protocol = key;
    chip.setAttribute('aria-pressed', String(protocolFilter === key));
    chip.append(h('span', '', label), h('b', '', faNum(count)));
    chip.addEventListener('click', () => { protocolFilter = key; renderProtocolFilters(); applyFilter(); });
    host.append(chip);
  };
  add('all', 'همه', allConfigs().length);
  for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) add(key, PROTOCOL_LABEL[key] || key, count);
}

function applyFilter(): void {
  const query = $<HTMLInputElement>('search-input').value.trim().toLowerCase();
  const active = filterActive();
  let shown = 0;
  for (const group of Array.from($('results').children) as HTMLElement[]) {
    const cards = Array.from(group.querySelectorAll<HTMLElement>('.config-card'));
    // Pending, locked and failed files stay visible: they carry a user action,
    // not a filterable result.
    if (!cards.length) { group.hidden = false; continue; }
    const entry = entries.find(item => item.id === Number(group.dataset.entry));
    let visible = 0;
    for (const card of cards) {
      const config = entry?.result?.configs[Number(card.dataset.index)];
      const match = !!config && matchesFilter(config, query);
      card.hidden = !match;
      if (match) visible++;
    }
    group.hidden = visible === 0;
    shown += visible;
  }
  const total = allConfigs().length;
  $('filter-empty').hidden = !(total > 0 && shown === 0 && active);
  $('search-clear').hidden = query === '';
  updateSummary();
}

function updateSummary(): void {
  const total = allConfigs().length;
  const selected = visibleConfigs();
  const links = selected.filter(item => item.config.uri).length;
  $('empty-state').hidden = entries.length > 0;
  $('results-toolbar').hidden = total === 0;
  $('result-count').textContent = total
    ? (filterActive() ? `${faNum(selected.length)} از ${faNum(total)} کانفیگ` : `${faNum(total)} کانفیگ`)
    : entries.length ? `${faNum(entries.length)} فایل` : 'خروجی';
  const copyAll = $<HTMLButtonElement>('copy-all'), downloadAll = $<HTMLButtonElement>('download-all');
  copyAll.disabled = links === 0;
  downloadAll.disabled = selected.length === 0;
  $('copy-count').textContent = faNum(links);
  const copyLabel = copyAll.querySelector('.btn-label');
  if (copyLabel && !copyAll.classList.contains('is-done')) copyLabel.textContent = filterActive() ? 'کپی لینک‌های فیلترشده' : 'کپی همهٔ لینک‌ها';
  const mobileBar = $('mobile-bar');
  mobileBar.hidden = total === 0;
  $<HTMLButtonElement>('mobile-copy').disabled = links === 0;
  $<HTMLButtonElement>('mobile-zip').disabled = selected.length === 0;
  const note = $('toolbar-note');
  note.classList.toggle('warn', reveal);
  note.textContent = reveal
    ? 'اطلاعات محرمانه نمایش داده می‌شود؛ مراقب ضبط صفحه و اشتراک‌گذاری باش.'
    : filterActive()
      ? 'فیلتر فعال است؛ کپی و دانلود فقط روی موارد مطابق فیلتر اعمال می‌شود.'
      : 'نمایش امن فعال است؛ کپی و دانلود همیشه خروجی کامل می‌دهند.';
}

function refreshSecrets(): void {
  for (const { entry, config, index } of allConfigs()) {
    const card = document.querySelector<HTMLElement>(`.config-card[data-entry="${entry.id}"][data-index="${index}"]`);
    if (!card) continue;
    const uri = card.querySelector<HTMLElement>('.uri-preview');
    if (uri && config.uri) uri.textContent = reveal ? config.uri : maskUri(config.uri);
    const raw = card.querySelector<HTMLElement>('.raw-json');
    if (raw) raw.textContent = JSON.stringify(reveal ? config.raw : redact(config.raw), null, 2);
  }
  updateSummary();
}

/* ---------------- rendering ---------------- */

function configCard(entry: Entry, config: ConfigItem, index: number): HTMLElement {
  const card = h('article', 'config-card');
  card.dataset.entry = String(entry.id);
  card.dataset.index = String(index);

  const top = h('div', 'config-top');
  top.append(badge((PROTOCOL_LABEL[config.protocol] || config.protocol).toUpperCase(), `protocol ${config.protocol}`));
  const title = h('div', 'config-title');
  title.append(h('h3', '', config.name));
  if (config.host) {
    const endpoint = h('p', '', `${config.host.includes(':') ? `[${config.host}]` : config.host}${config.port ? `:${config.port}` : ''}`);
    endpoint.dir = 'ltr';
    title.append(endpoint);
  }
  top.append(title); card.append(top);

  const tags = h('div', 'config-tags');
  if (config.transport) tags.append(h('span', '', config.transport.toUpperCase()));
  if (config.security) tags.append(h('span', '', config.security.toUpperCase()));
  tags.append(h('span', '', config.uri ? 'SHARE LINK + JSON' : 'RAW JSON'));
  card.append(tags);

  if (config.uri) {
    const code = h('code', 'uri-preview', reveal ? config.uri : maskUri(config.uri));
    code.dir = 'ltr';
    card.append(code);
  }
  for (const warning of config.warnings) card.append(h('p', 'warning', warning));

  const actions = h('div', 'config-actions');
  if (config.uri) {
    const copy = button('کپی لینک', 'copy', 'button small secondary'); copy.dataset.action = 'copy-uri';
    const download = button('دانلود لینک', 'download'); download.dataset.action = 'download-uri';
    actions.append(copy, download);
  }
  const jsonButton = button('JSON کامل', 'code');
  jsonButton.dataset.action = 'toggle-json';
  jsonButton.setAttribute('aria-expanded', 'false');
  actions.append(jsonButton);
  card.append(actions);

  const raw = h('pre', 'raw-json', JSON.stringify(reveal ? config.raw : redact(config.raw), null, 2));
  raw.hidden = true; raw.dir = 'ltr'; raw.tabIndex = 0; raw.setAttribute('aria-label', 'JSON بازیابی‌شده');
  const rawActions = h('div', 'config-actions'); rawActions.hidden = true;
  const copyJson = button('کپی JSON', 'copy'); copyJson.dataset.action = 'copy-json';
  const downloadJson = button('دانلود JSON', 'download'); downloadJson.dataset.action = 'download-json';
  rawActions.append(copyJson, downloadJson);
  card.append(raw, rawActions);
  return card;
}

function appendConfigs(entry: Entry, group: HTMLElement): void {
  const configs = entry.result?.configs || [];
  group.querySelector('.more-button')?.remove();
  const limit = Math.min(configs.length, entry.rendered + CHUNK);
  for (let index = entry.rendered; index < limit; index++) group.append(configCard(entry, configs[index]!, index));
  entry.rendered = limit;
  if (limit < configs.length) {
    const more = button(`نمایش ${faNum(Math.min(CHUNK, configs.length - limit))} کانفیگ دیگر از ${faNum(configs.length)}`, 'chevron', 'button small ghost more-button');
    more.addEventListener('click', () => { appendConfigs(entry, group); applyFilter(); });
    group.append(more);
  }
}

function renderEntry(entry: Entry): void {
  const group = h('section', 'file-group');
  group.id = `file-${entry.id}`;
  group.dataset.entry = String(entry.id);

  const header = h('div', 'file-header');
  header.append(icon(entry.status === 'locked' ? 'lock' : entry.status === 'error' ? 'alert' : 'file'));
  const info = h('div', 'file-info');
  info.append(h('strong', '', entry.name));
  const meta = h('div', 'file-meta');
  meta.append(h('span', '', sizeLabel(entry.size)));
  if (entry.result) {
    meta.append(
      h('span', '', `${entry.result.format}${entry.result.format === 'NPVS' ? ` v${entry.result.version}` : ''}`),
      h('span', '', `${faNum(entry.result.configs.length)} کانفیگ`),
    );
    if (entry.duration !== undefined) meta.append(h('span', '', `${faDigits((entry.duration / 1000).toFixed(2))} ثانیه`));
  }
  info.append(meta); header.append(info);

  const labels: Record<EntryStatus, [string, string]> = {
    queued: ['در صف', 'badge'], working: ['در حال پردازش', 'badge'],
    locked: ['گذرواژه‌دار', 'badge locked'], done: ['باز شد', 'badge success'], error: ['باز نشد', 'badge error'],
  };
  const actions = h('div', 'file-actions');
  actions.append(badge(...labels[entry.status]));
  const remove = h('button', 'icon-button tiny'); remove.type = 'button';
  remove.setAttribute('aria-label', `حذف ${entry.name}`); remove.title = 'حذف این فایل';
  remove.append(icon('x'));
  remove.addEventListener('click', () => removeEntry(entry.id));
  actions.append(remove);
  header.append(actions);
  group.append(header);

  if (entry.status === 'working' || entry.status === 'queued') {
    const status = h('div', 'status-box');
    if (entry.status === 'working') status.append(h('span', 'spinner'));
    status.append(h('span', '', entry.status === 'working' ? 'در حال بازگشایی و بررسی ساختار روی دستگاه شما…' : 'در صف پردازش…'));
    group.append(status);
  }

  if (entry.status === 'locked') {
    const box = h('div', 'unlock-box');
    const heading = h('h3');
    heading.append(icon('lock'), document.createTextNode('این فایل گذرواژه دارد'));
    box.append(heading, h('p', '', 'گذرواژه‌ای را که سازندهٔ فایل داده وارد کن. بررسی فقط روی همین دستگاه انجام می‌شود؛ رمز را در چت یا سایت دیگری نفرست.'));
    const form = h('form', 'unlock-form'); form.dataset.entry = String(entry.id);
    const field = h('div', 'password-field');
    const input = h('input');
    input.type = 'password'; input.name = 'local-passphrase'; input.autocomplete = 'off';
    input.maxLength = 4096; input.required = true; input.placeholder = 'گذرواژهٔ فایل';
    input.setAttribute('aria-label', `گذرواژهٔ ${entry.name}`);
    input.setAttribute('autocapitalize', 'off'); input.spellcheck = false;
    const toggle = h('button', 'icon-button'); toggle.type = 'button';
    toggle.setAttribute('aria-label', 'نمایش گذرواژه'); toggle.append(icon('eye'));
    toggle.addEventListener('click', () => {
      const shown = input.type === 'text';
      input.type = shown ? 'password' : 'text';
      toggle.setAttribute('aria-label', shown ? 'نمایش گذرواژه' : 'پنهان کردن گذرواژه');
      toggle.replaceChildren(icon(shown ? 'eye' : 'eye-off'));
      input.focus();
    });
    field.append(input, toggle);
    const submit = button('باز کردن', 'unlock', 'button small primary'); submit.type = 'submit';
    form.append(field, submit); box.append(form);
    if (entry.message) box.append(h('p', 'error-text', entry.message));
    group.append(box);
  }

  if (entry.status === 'error') {
    const box = h('div', 'error-box');
    box.append(icon('alert'), h('span', '', entry.message || 'این فایل قابل پردازش نیست.'));
    group.append(box);
  }

  if (entry.result) {
    for (const warning of entry.result.warnings) group.append(h('p', 'warning file-warning', warning));
    entry.rendered = 0;
    appendConfigs(entry, group);
  }

  const previous = document.getElementById(group.id);
  if (previous) previous.replaceWith(group); else $('results').append(group);
  applyFilter();
}

function updateQueueProgress(): void {
  const pending = entries.filter(entry => entry.status === 'queued' || entry.status === 'working').length;
  const node = $('queue-progress');
  node.hidden = pending === 0;
  if (pending) {
    const done = entries.filter(entry => entry.status === 'done' || entry.status === 'error' || entry.status === 'locked').length;
    node.textContent = `پردازش ${faNum(done + 1)} از ${faNum(done + pending)}`;
  }
}

/* ---------------- worker plumbing ---------------- */

function discardBytes(entry: Entry): void { entry.bytes?.fill(0); delete entry.bytes; delete entry.file; }

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker('./worker.js', { name: 'open-npv-decoder' });
  worker.onmessage = (event: MessageEvent<WorkerResult>) => {
    const response = event.data;
    if (response.kind !== 'decode' || response.id !== currentId) return;
    clearTimeout(jobTimer);
    const entry = entries.find(item => item.id === response.id);
    currentId = null;
    if (entry) {
      entry.duration = performance.now() - (entry.duration || performance.now());
      if (response.ok) {
        entry.status = 'done'; entry.result = response.result; delete entry.message; discardBytes(entry);
        announce(`${entry.name} باز شد؛ ${faNum(response.result.configs.length)} کانفیگ پیدا شد.`);
      } else {
        entry.code = response.code; entry.message = response.message;
        entry.status = response.code === 'PASSWORD_REQUIRED' || response.code === 'BAD_PASSWORD' ? 'locked' : 'error';
        if (entry.status === 'error') discardBytes(entry);
        announce(response.message);
      }
      renderEntry(entry);
      if (entry.status === 'locked') document.querySelector<HTMLInputElement>(`#file-${entry.id} input`)?.focus({ preventScroll: true });
      renderProtocolFilters();
    }
    updateQueueProgress(); updateSummary(); processNext();
  };
  worker.onerror = event => { event.preventDefault(); failCurrent('پردازشگر متوقف شد. دوباره فایل را انتخاب کن.'); };
  return worker;
}

function failCurrent(message: string): void {
  clearTimeout(jobTimer);
  worker?.terminate(); worker = null;
  const entry = entries.find(item => item.id === currentId);
  currentId = null;
  if (entry) { entry.status = 'error'; entry.message = message; discardBytes(entry); renderEntry(entry); }
  updateQueueProgress(); updateSummary(); processNext();
}

function postJob(entry: Entry, password = ''): void {
  if (!entry.bytes) {
    entry.status = 'error'; entry.message = 'دادهٔ فایل در دسترس نیست؛ دوباره انتخابش کن.';
    renderEntry(entry); processNext(); return;
  }
  entry.status = 'working'; entry.duration = performance.now(); delete entry.message;
  renderEntry(entry); updateQueueProgress();
  try {
    const copy = entry.bytes.slice();
    ensureWorker().postMessage({ kind: 'decode', id: entry.id, bytes: copy, password }, [copy.buffer as ArrayBuffer]);
    jobTimer = setTimeout(() => failCurrent('پردازش بیش از حد طول کشید و متوقف شد. فایل ممکن است آسیب دیده باشد.'), 60000);
  } catch {
    failCurrent('پردازشگر محلی اجرا نشد. صفحه را در مرورگری جدید روی HTTPS باز کن.');
  }
}

function processNext(): void {
  if (currentId !== null) return;
  const entry = entries.find(item => item.status === 'queued');
  if (!entry) { updateQueueProgress(); return; }
  currentId = entry.id; entry.status = 'working'; renderEntry(entry); updateQueueProgress();
  void (async () => {
    try {
      if (entry.file) entry.bytes = new Uint8Array(await entry.file.arrayBuffer());
      if (currentId === entry.id) postJob(entry);
    } catch {
      if (currentId === entry.id) failCurrent('خواندن فایل از دستگاه ممکن نشد. دوباره انتخابش کن.');
    }
  })();
}

function enqueue(files: File[]): void {
  if (!files.length) return;
  if (entries.length + files.length > MAX_FILES) {
    toast(`در هر نوبت حداکثر ${faNum(MAX_FILES)} فایل پردازش می‌شود. ابتدا نتایج را پاک کن.`, 'error'); return;
  }
  const total = entries.reduce((sum, entry) => sum + entry.size, 0) + files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES) { toast('مجموع فایل‌ها در هر نوبت باید حداکثر ۶۴ مگابایت باشد.', 'error'); return; }
  let added = 0;
  for (const file of files) {
    if (file.size === 0) { toast(`فایل «${file.name.slice(0, 80)}» خالی است.`, 'error'); continue; }
    if (file.size > MAX_FILE_BYTES) { toast(`فایل «${file.name.slice(0, 80)}» از ۱۶ مگابایت بزرگ‌تر است.`, 'error'); continue; }
    const entry: Entry = { id: nextId++, name: file.name, size: file.size, status: 'queued', file, rendered: 0 };
    entries.push(entry); renderEntry(entry); added++;
  }
  if (added) {
    updateSummary(); updateQueueProgress(); processNext();
    if (window.matchMedia('(max-width: 980px)').matches) document.querySelector('.output-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function removeEntry(id: number): void {
  const index = entries.findIndex(entry => entry.id === id);
  if (index < 0) return;
  const entry = entries[index]!;
  if (currentId === id) { clearTimeout(jobTimer); worker?.terminate(); worker = null; currentId = null; }
  discardBytes(entry);
  entries.splice(index, 1);
  document.getElementById(`file-${id}`)?.remove();
  renderProtocolFilters(); applyFilter(); updateSummary(); updateQueueProgress(); processNext();
  toast('فایل از فهرست حذف شد.', 'info');
}

function clearAll(): void {
  clearTimeout(jobTimer);
  worker?.terminate(); worker = null; currentId = null;
  zipWorker?.terminate(); zipWorker = null;
  for (const entry of entries) discardBytes(entry);
  entries.length = 0;
  $('results').replaceChildren();
  $<HTMLInputElement>('file-input').value = '';
  $<HTMLTextAreaElement>('paste-input').value = '';
  $<HTMLInputElement>('search-input').value = '';
  protocolFilter = 'all';
  setReveal(false);
  renderProtocolFilters(); applyFilter(); updateSummary(); updateQueueProgress();
  toast('نتایج پاک شد و پردازشگر متوقف شد.', 'success');
}

/* ---------------- clipboard + downloads ---------------- */

function download(data: BlobPart, name: string, type = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = h('a'); anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function copy(value: string, source?: HTMLButtonElement): Promise<void> {
  const done = () => { if (source) flashDone(source); toast('خروجی کامل کپی شد؛ کلیپ‌بورد می‌تواند اطلاعات محرمانه را نگه دارد.', 'success'); };
  try {
    await navigator.clipboard.writeText(value); done();
  } catch {
    const area = h('textarea');
    area.value = value; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.append(area); area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* Explicit fallback only. */ }
    area.remove();
    if (ok) done();
    else toast('کپی در این محیط مجاز نیست؛ از دانلود لینک یا انتخاب متن استفاده کن.', 'error');
  }
}

function copyVisible(source?: HTMLButtonElement): void {
  const links = visibleConfigs().map(item => item.config.uri).filter((uri): uri is string => !!uri);
  if (!links.length) { toast('لینکی برای کپی وجود ندارد.', 'error'); return; }
  void copy(links.join('\n'), source);
}

async function downloadAll(trigger?: HTMLButtonElement): Promise<void> {
  if (zipBusy) return;
  const selected = visibleConfigs();
  if (!selected.length) return;
  zipBusy = true;
  const files: Record<string, string> = {};
  const used = new Set<string>();
  const links: string[] = [];
  const report = selected.map(({ entry, config, index }) => {
    let stem = `${String(entry.id).padStart(2, '0')}-${asciiStem(entry.name)}-${index + 1}-${config.protocol}`;
    while (used.has(stem)) stem += '-x';
    used.add(stem);
    if (config.uri) { files[`links/${stem}.txt`] = config.uri + '\n'; links.push(config.uri); }
    files[`json/${stem}.json`] = jsonText(config) + '\n';
    return { file: entry.name, name: config.name, protocol: config.protocol, hasShareLink: !!config.uri, warnings: config.warnings };
  });
  if (links.length) files['links.txt'] = links.join('\n') + '\n';
  files['report.json'] = JSON.stringify({
    generator: 'Open NPV 0.2.1',
    generatedAt: new Date().toISOString(),
    filter: { protocol: protocolFilter, query: $<HTMLInputElement>('search-input').value.trim() },
    configs: report,
    skipped: entries.filter(entry => entry.status !== 'done').map(entry => ({ file: entry.name, status: entry.status, message: entry.message || '' })),
  }, null, 2);
  files['README.txt'] = 'Open NPV — خروجی محرمانه است.\nlinks.txt: لینک‌های اشتراک\njson/: تنظیمات کامل هر کانفیگ\nreport.json: گزارش و هشدارها\nاین فایل‌ها را عمومی منتشر نکنید.\n';

  const buttons = [$<HTMLButtonElement>('download-all'), $<HTMLButtonElement>('mobile-zip'), trigger].filter(Boolean) as HTMLButtonElement[];
  for (const b of buttons) { b.disabled = true; b.classList.add('is-busy'); }
  try {
    const bytes = await runZip(files);
    download(bytes.buffer as ArrayBuffer, 'open-npv-configs.zip', 'application/zip');
    toast('فایل ZIP شامل اطلاعات محرمانه است؛ آن را عمومی منتشر نکن.', 'success');
  } catch {
    toast('ساخت ZIP ممکن نشد. می‌توانی لینک‌ها را کپی یا تک‌تک دانلود کنی.', 'error');
  } finally {
    zipBusy = false;
    for (const b of buttons) b.classList.remove('is-busy');
    updateSummary();
  }
}

function runZip(files: Record<string, string>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zipWorker?.terminate();
    let instance: Worker;
    try { instance = new Worker('./worker.js', { name: 'open-npv-zip' }); }
    catch { reject(new Error('worker')); return; }
    zipWorker = instance;
    const finish = () => { clearTimeout(zipTimer); instance.terminate(); if (zipWorker === instance) zipWorker = null; };
    instance.onmessage = (event: MessageEvent<WorkerResult>) => {
      const response = event.data;
      if (response.kind !== 'zip') return;
      finish();
      if (response.ok) resolve(response.bytes); else reject(new Error(response.message));
    };
    instance.onerror = event => { event.preventDefault(); finish(); reject(new Error('worker')); };
    zipTimer = setTimeout(() => { finish(); reject(new Error('timeout')); }, 120000);
    instance.postMessage({ kind: 'zip', id: 1, files });
  });
}

/* ---------------- reveal ---------------- */

function setReveal(value: boolean): void {
  reveal = value;
  const toggle = $<HTMLButtonElement>('reveal-toggle');
  toggle.setAttribute('aria-pressed', String(value));
  toggle.replaceChildren(icon(value ? 'eye-off' : 'eye'), h('span', '', value ? 'پنهان کردن اطلاعات محرمانه' : 'نمایش اطلاعات محرمانه'));
  refreshSecrets();
}

/* ---------------- events ---------------- */

const fileInput = $<HTMLInputElement>('file-input');
$('pick-button').addEventListener('click', () => fileInput.click());
$('hero-pick').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { enqueue(Array.from(fileInput.files || [])); fileInput.value = ''; });

async function loadDemo(): Promise<void> {
  try {
    const response = await fetch('./demo.npvt');
    if (!response.ok) throw new Error('demo');
    const bytes = await response.arrayBuffer();
    enqueue([new File([bytes], 'نمونهٔ ساختگی.npvt')]);
    toast('این نمونه ساختگی است؛ هیچ سرور یا اعتبارنامهٔ واقعی ندارد.', 'info');
  } catch { toast('نمونهٔ آزمایشی بارگذاری نشد؛ فایل خودت را انتخاب کن.', 'error'); }
}
$('demo-button').addEventListener('click', () => void loadDemo());
$('hero-demo').addEventListener('click', () => void loadDemo());

$('paste-button').addEventListener('click', () => {
  const value = $<HTMLTextAreaElement>('paste-input').value.trim();
  if (!value) { toast('ابتدا محتوای NPVT1 یا NPVO1 را جای‌گذاری کن.', 'error'); return; }
  if (!/^(NPVT1|NPVO1)/.test(value)) { toast('متن باید با NPVT1 یا NPVO1 شروع شود. NPVS باینری را به‌صورت فایل انتخاب کن.', 'error'); return; }
  enqueue([new File([value], `pasted-${nextId}.npvt`, { type: 'application/octet-stream' })]);
});

$('clear-button').addEventListener('click', clearAll);
$('search-input').addEventListener('input', applyFilter);
$('search-clear').addEventListener('click', () => { $<HTMLInputElement>('search-input').value = ''; applyFilter(); $<HTMLInputElement>('search-input').focus(); });
$('reset-filters').addEventListener('click', () => {
  $<HTMLInputElement>('search-input').value = ''; protocolFilter = 'all';
  renderProtocolFilters(); applyFilter();
});
$('reveal-toggle').addEventListener('click', () => setReveal(!reveal));
$('copy-all').addEventListener('click', () => copyVisible($<HTMLButtonElement>('copy-all')));
$('mobile-copy').addEventListener('click', () => copyVisible($<HTMLButtonElement>('mobile-copy')));
$('download-all').addEventListener('click', () => void downloadAll($<HTMLButtonElement>('download-all')));
$('mobile-zip').addEventListener('click', () => void downloadAll($<HTMLButtonElement>('mobile-zip')));

$('results').addEventListener('submit', event => {
  const form = event.target as HTMLFormElement;
  if (!form.matches('.unlock-form')) return;
  event.preventDefault();
  if (currentId !== null) { toast('صبر کن تا پردازش فایل فعلی تمام شود.', 'info'); return; }
  const entry = entries.find(item => item.id === Number(form.dataset.entry));
  if (!entry || entry.status !== 'locked') return;
  const input = form.querySelector<HTMLInputElement>('input')!;
  const password = input.value;
  input.value = '';
  currentId = entry.id;
  postJob(entry, password);
});

$('results').addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
  if (!target) return;
  const card = target.closest<HTMLElement>('.config-card');
  if (!card) return;
  const entry = entries.find(item => item.id === Number(card.dataset.entry));
  const index = Number(card.dataset.index);
  const config = entry?.result?.configs[index];
  if (!entry || !config) return;
  const stem = `${asciiStem(entry.name)}-${index + 1}-${config.protocol}`;
  switch (target.dataset.action) {
    case 'copy-uri': if (config.uri) void copy(config.uri, target); break;
    case 'download-uri': if (config.uri) download(config.uri + '\n', `${stem}.txt`); break;
    case 'copy-json': void copy(jsonText(config), target); break;
    case 'download-json': download(jsonText(config) + '\n', `${stem}.json`, 'application/json;charset=utf-8'); break;
    case 'toggle-json': {
      const raw = card.querySelector<HTMLElement>('.raw-json')!;
      raw.hidden = !raw.hidden;
      (raw.nextElementSibling as HTMLElement).hidden = raw.hidden;
      target.setAttribute('aria-expanded', String(!raw.hidden));
      break;
    }
  }
});

/* drag & drop anywhere on the page */
let dragDepth = 0;
const overlay = $('drop-overlay'), dropzone = $('dropzone');
function hasFiles(event: DragEvent): boolean { return Array.from(event.dataTransfer?.types || []).includes('Files'); }
window.addEventListener('dragenter', event => {
  if (!hasFiles(event)) return;
  event.preventDefault(); dragDepth++;
  overlay.classList.add('visible'); dropzone.classList.add('dragging');
});
window.addEventListener('dragover', event => { if (hasFiles(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', event => {
  if (!hasFiles(event)) return;
  if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove('visible'); dropzone.classList.remove('dragging'); }
});
window.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0;
  overlay.classList.remove('visible'); dropzone.classList.remove('dragging');
  enqueue(Array.from(event.dataTransfer?.files || []));
});

/* keyboard */
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement | null;
  const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (event.key === '/' && !typing && !$('results-toolbar').hidden) {
    event.preventDefault(); $<HTMLInputElement>('search-input').focus();
  } else if (event.key === 'Escape' && target === $('search-input')) {
    $<HTMLInputElement>('search-input').value = ''; applyFilter();
  }
});

/* dialogs */
for (const trigger of document.querySelectorAll<HTMLButtonElement>('[data-dialog]')) {
  trigger.addEventListener('click', () => $<HTMLDialogElement>(trigger.dataset.dialog!).showModal());
}
for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog')) {
  for (const closer of dialog.querySelectorAll<HTMLElement>('[data-close]')) closer.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}

/* theme */
function applyTheme(theme: string): void {
  document.documentElement.dataset.theme = theme;
  const btn = $('theme-button');
  btn.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
  btn.setAttribute('aria-label', theme === 'dark' ? 'تغییر به پوستهٔ روشن' : 'تغییر به پوستهٔ تاریک');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d151d' : '#f4f7fa');
}
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
$('theme-button').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try { localStorage.setItem('open-npv-theme', theme); } catch { /* Optional. */ }
});
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', event => {
  let stored: string | null = null;
  try { stored = localStorage.getItem('open-npv-theme'); } catch { /* Optional. */ }
  if (stored !== 'light' && stored !== 'dark') applyTheme(event.matches ? 'light' : 'dark');
});

/* install */
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event as InstallPrompt;
  $('install-button').hidden = false;
});
$('install-button').addEventListener('click', async () => {
  if (!installPrompt) return;
  try { await installPrompt.prompt(); await installPrompt.userChoice; } catch { /* Dismissed. */ }
  installPrompt = null; $('install-button').hidden = true;
});
window.addEventListener('appinstalled', () => { $('install-button').hidden = true; toast('Open NPV نصب شد.', 'success'); });

/* offline status + updates */
function networkStatus(): void {
  $('status-text').textContent = !navigator.onLine
    ? (offlineReady ? 'آفلاین هستی؛ ابزار همچنان روی دستگاه خودت کار می‌کند.' : 'آفلاین هستی. برای بار اول، نسخهٔ آنلاین را باز کن.')
    : offlineReady ? 'نسخهٔ آفلاین آماده است؛ فایل‌های شما هرگز آپلود نمی‌شوند.' : 'در حال آماده‌سازی نسخهٔ آفلاین…';
}
window.addEventListener('online', networkStatus);
window.addEventListener('offline', networkStatus);

let reloading = false;
function activateUpdate(): void {
  const waiting = pendingRegistration?.waiting;
  if (!waiting) { toast('نسخهٔ جدیدی در انتظار نیست.', 'info'); return; }
  if (currentId !== null) { toast('اول پردازش فعلی را تمام یا پاک کن.', 'error'); return; }
  reloading = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
$('update-button').addEventListener('click', () => {
  if (entries.length) { $<HTMLDialogElement>('update-dialog').showModal(); return; }
  activateUpdate();
});
$('confirm-update').addEventListener('click', () => { $<HTMLDialogElement>('update-dialog').close(); activateUpdate(); });

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
  void navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(registration => {
    pendingRegistration = registration;
    const offerUpdate = () => {
      const isUpdate = !!registration.waiting && !!registration.active;
      $('update-button').hidden = !isUpdate;
      if (isUpdate) $('status-text').textContent = 'نسخهٔ جدید آماده است. هر وقت آماده بودی به‌روزرسانی کن.';
      else networkStatus();
    };
    offerUpdate();
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        offerUpdate();
        if (installing.state === 'redundant' && !registration.active) {
          $('status-text').textContent = 'نصب کش آفلاین کامل نشد؛ فضا یا شبکه را بررسی کن. پردازش فایل همچنان محلی است.';
          $('status-bar').dataset.state = 'error';
        }
      });
    });
    void navigator.serviceWorker.ready.then(() => {
      offlineReady = true;
      $('status-bar').dataset.state = 'ready';
      networkStatus(); offerUpdate();
    });
  }).catch(() => {
    $('status-text').textContent = 'کش آفلاین در این محیط فعال نشد؛ پردازش فایل همچنان محلی است.';
    $('status-bar').dataset.state = 'error';
  });
} else {
  $('status-text').textContent = 'برای نصب و کش آفلاین، ابزار را روی HTTPS باز کن. پردازش فایل محلی است.';
  $('status-bar').dataset.state = 'error';
}

networkStatus();
updateSummary();
setReveal(false);
