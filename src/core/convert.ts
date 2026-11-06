// SPDX-License-Identifier: AGPL-3.0-only
import type { ConfigItem, Json, JsonObject, Protocol } from './types.js';
import { base64, DecodeError, ensure, integer, object, parseJson, port, str, truthy, unbase64, unique } from './utils.js';

type Flat = Record<string, string>;
const networks = new Set(['tcp', 'raw', 'ws', 'h2', 'http', 'grpc', 'kcp', 'quic', 'httpupgrade', 'xhttp']);
const types: Record<number, Protocol> = { 1: 'vmess', 3: 'ss', 5: 'vless', 6: 'trojan' };
const knownFlat = new Set(('configType server serverPort port password method network security sni host path headerType seed serviceName mode authority fingerPrint fingerprint alpn insecure tlsAllowInsecure publicKey shortId spiderX flow alterId encryption remarks name address quicSecurity key xhttpMode xhttpExtra mldsa65Verify pqv ech pcs vcn fm finalmask').split(' '));
const rawOnly = 'تبدیل بدون اتلاف به لینک ممکن نیست؛ JSON کاملِ بازیابی‌شده را نگه دارید.';

function flatMap(value: JsonObject): Flat {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : str(v)]));
}
function hostPort(host: string, number: number): string { return `${host.includes(':') ? `[${host.replace(/^\[|\]$/g, '')}]` : host}:${number}`; }
function endpoint(p: Flat): { host: string; port: number } {
  let host = (p.server || '').trim();
  let number = p.serverPort || p.port ? port(p.serverPort || p.port) : 0;
  const address = (p.address || '').trim();
  if (!host) {
    const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(address);
    if (bracket) { host = bracket[1]!; if (!number && bracket[2]) number = port(bracket[2]); }
    else if ((address.match(/:/g) || []).length === 1) {
      const parts = address.split(':'); host = parts[0]!; if (!number) number = port(parts[1]);
    } else host = address;
  }
  const bracket = /^\[([^\]]+)\]:(\d+)$/.exec(host);
  if (bracket) { host = bracket[1]!; if (!number) number = port(bracket[2]); }
  else if ((host.match(/:/g) || []).length === 1) {
    const parts = host.split(':'); host = parts[0]!; if (!number) number = port(parts[1]);
  }
  host = host.replace(/^\[|\]$/g, '');
  ensure(host && !/[\s/@?#]/.test(host), 'FORMAT', 'آدرس سرور در کانفیگ معتبر نیست.');
  return { host, port: port(number) };
}
function query(entries: Array<[string, string | undefined]>): string {
  return entries.filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}
function fragment(name: string): string { return name ? `#${encodeURIComponent(name)}` : ''; }
function allowInsecure(p: Flat): boolean { return truthy(p.tlsAllowInsecure ?? p.insecure ?? 'false'); }

function streamEntries(p: Flat, protocol: Protocol): Array<[string, string | undefined]> {
  const network = (p.network || 'tcp').toLowerCase();
  const security = (p.security || 'none').toLowerCase();
  ensure(networks.has(network), 'UNSUPPORTED', `انتقال «${network.slice(0, 24)}» لینک استانداردِ پشتیبانی‌شده ندارد.`);
  ensure(['none', 'tls', 'reality'].includes(security), 'UNSUPPORTED', 'این نوع امنیت در تبدیل لینک پشتیبانی نمی‌شود.');
  ensure(!(protocol === 'vmess' && (security === 'reality' || network === 'xhttp')), 'UNSUPPORTED', 'لینک اشتراک قدیمی VMess نمی‌تواند همهٔ تنظیمات REALITY یا XHTTP را حمل کند.');
  const entries: Array<[string, string | undefined]> = [['type', network], ['security', security]];
  const add = (key: string, value: string | undefined) => { if (value !== undefined && value !== '') entries.push([key, value]); };
  switch (network) {
    case 'ws': add('path', p.path); add('host', p.host); break;
    case 'grpc': add('serviceName', p.serviceName); entries.push(['mode', p.mode || 'gun']); add('authority', p.authority); break;
    case 'kcp': add('headerType', p.headerType); add('seed', p.seed); break;
    case 'quic': add('quicSecurity', p.quicSecurity); add('key', p.key); add('headerType', p.headerType); break;
    case 'httpupgrade': add('path', p.path); add('host', p.host); break;
    case 'xhttp': add('path', p.path); add('host', p.host); add('mode', p.xhttpMode || p.mode); add('extra', p.xhttpExtra); break;
    case 'tcp': case 'raw':
      if (p.headerType && p.headerType !== 'none') { entries.push(['headerType', p.headerType]); add('host', p.host); add('path', p.path); }
      break;
    case 'http': case 'h2': add('host', p.host); add('path', p.path); break;
  }
  if (security === 'tls') {
    add('sni', p.sni); add('fp', p.fingerPrint || p.fingerprint);
    add('alpn', p.alpn);
    if (allowInsecure(p)) entries.push(['allowInsecure', '1']);
    add('ech', p.ech); add('pcs', p.pcs); add('vcn', p.vcn);
  }
  if (security === 'reality') {
    ensure(!!p.publicKey, 'FORMAT', 'کلید عمومی REALITY در پروفایل موجود نیست.');
    add('sni', p.sni); add('fp', p.fingerPrint || p.fingerprint);
    entries.push(['pbk', p.publicKey!]);
    // An explicitly empty shortId is meaningful and must not be dropped.
    if (Object.hasOwn(p, 'shortId')) entries.push(['sid', p.shortId!]);
    add('spx', p.spiderX); add('pqv', p.pqv || p.mldsa65Verify);
  }
  add('fm', p.fm || p.finalmask);
  return entries;
}

function vmessURI(p: Flat, end: { host: string; port: number }, name: string): string {
  const network = (p.network || 'tcp').toLowerCase();
  let headerType = p.headerType || 'none', path = p.path || '', host = p.host || '';
  if (network === 'kcp') path ||= p.seed || '';
  if (network === 'grpc') { headerType = p.mode || 'gun'; path ||= p.serviceName || ''; host ||= p.authority || ''; }
  if (((network === 'tcp' || network === 'raw') && headerType === 'none') || network === 'quic') { path = ''; host = ''; }
  const payload: Flat = {
    v: '2', ps: name, add: end.host, port: String(end.port), id: p.password || '',
    aid: String(integer(p.alterId)), scy: p.method || 'auto', net: network, type: headerType,
    host, path, tls: p.security === 'tls' ? 'tls' : '', sni: p.sni || '',
    fp: p.fingerPrint || p.fingerprint || '', alpn: p.alpn || '',
  };
  if (p.security === 'tls' && allowInsecure(p)) payload.insecure = '1';
  return `vmess://${base64(new TextEncoder().encode(JSON.stringify(payload)))}`;
}

function flatConfiguration(profile: JsonObject, raw: Json, wrapperName = '', address = ''): ConfigItem {
  const p = flatMap(profile);
  if (address) p.address = address;
  const protocol = types[integer(p.configType)] || 'other';
  const name = wrapperName || p.remarks || p.name || 'کانفیگ بدون نام';
  const item: ConfigItem = { name, protocol, raw, warnings: [] };
  try {
    ensure(protocol !== 'other', 'UNSUPPORTED', 'این نوع کانفیگ لینک اشتراک استاندارد ندارد؛ دادهٔ خام حفظ شده است.');
    const end = endpoint(p);
    ensure(!!p.password, 'FORMAT', 'شناسه یا گذرواژهٔ اتصال در پروفایل موجود نیست.');
    item.host = end.host; item.port = end.port;
    item.transport = p.network || 'tcp'; item.security = p.security || 'none';
    const entries = streamEntries(p, protocol);
    if (protocol === 'vless') {
      entries.push(['encryption', p.encryption || p.method || 'none']);
      if (p.flow) entries.push(['flow', p.flow]);
      item.uri = `vless://${encodeURIComponent(p.password)}@${hostPort(end.host, end.port)}?${query(entries)}${fragment(name)}`;
    } else if (protocol === 'trojan') {
      item.uri = `trojan://${encodeURIComponent(p.password)}@${hostPort(end.host, end.port)}?${query(entries)}${fragment(name)}`;
    } else if (protocol === 'vmess') item.uri = vmessURI(p, end, name);
    else {
      ensure(!!p.method && !p.method.includes(':'), 'FORMAT', 'روش رمزنگاری Shadowsocks معتبر نیست.');
      ensure(!p.network && !p.security, 'UNSUPPORTED', 'لینک Shadowsocks تنظیمات انتقال اضافی را حمل نمی‌کند.');
      item.uri = `ss://${base64(new TextEncoder().encode(`${p.method}:${p.password}`), true)}@${hostPort(end.host, end.port)}${fragment(name)}`;
    }
    validateShareUri(item.uri);
  } catch (error) {
    item.warnings.push(error instanceof DecodeError ? error.message : rawOnly);
  }
  const extras = Object.entries(p).filter(([k, v]) => !knownFlat.has(k) && v !== '' && v !== 'false' && v !== '0' && v !== 'null' && v !== '{}' && v !== '[]');
  if (extras.length) item.warnings.push('برخی فیلدهای مخصوص برنامه فقط در JSON کامل حفظ شده‌اند.');
  if (allowInsecure(p) && p.security === 'tls') item.warnings.push('در کانفیگ اصلی، اعتبارسنجی گواهی TLS غیرفعال است؛ ابزار این تنظیم را تغییر نمی‌دهد.');
  item.warnings = unique(item.warnings);
  return item;
}

function headerHost(headers: Json | undefined): string {
  if (!object(headers)) return '';
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === 'host') {
    return Array.isArray(value) ? str(value[0]) : str(value);
  }
  return '';
}
function outboundConfiguration(outbound: JsonObject, root: JsonObject, index: number): ConfigItem | undefined {
  const protocol = str(outbound.protocol).toLowerCase();
  const passthrough = ['freedom', 'blackhole', 'dns', 'loopback', ''];
  if (passthrough.includes(protocol)) return undefined;
  const count = Array.isArray(root.outbounds) ? root.outbounds.filter(o => object(o) && !passthrough.includes(str(o.protocol).toLowerCase())).length : 1;
  const name = `${str(root.remarks) || str(outbound.tag) || 'کانفیگ'}${count > 1 ? ` · ${str(outbound.tag) || index + 1}` : ''}`;
  const settings = object(outbound.settings) ? outbound.settings : {};
  const stream = object(outbound.streamSettings) ? outbound.streamSettings : {};
  const p: Flat = { configType: str(({ vless: 5, vmess: 1, trojan: 6, shadowsocks: 3 } as Record<string, number>)[protocol] || 0), network: str(stream.network), security: str(stream.security) };
  const item: ConfigItem = { name, protocol: protocol === 'shadowsocks' ? 'ss' : (['vless', 'vmess', 'trojan'].includes(protocol) ? protocol as Protocol : 'other'), raw: root, warnings: [] };
  try {
    ensure(['vless', 'vmess', 'trojan', 'shadowsocks'].includes(protocol), 'UNSUPPORTED', rawOnly);
    ensure(!(object(outbound.mux) && truthy(outbound.mux.enabled)), 'UNSUPPORTED', rawOnly);
    ensure(!object(outbound.proxySettings), 'UNSUPPORTED', rawOnly);
    ensure(!object(stream.sockopt) && !object(stream.finalmask), 'UNSUPPORTED', 'sockopt یا finalmask در JSON کامل حفظ شده است؛ لینک معادلِ کامل نیست.');
    if (protocol === 'vless' || protocol === 'vmess') {
      const entries = Array.isArray(settings.vnext) ? settings.vnext.filter(object) : [];
      ensure(entries.length === 1, 'UNSUPPORTED', 'چند سرور در یک outbound وجود دارد؛ JSON کامل حفظ شده است.');
      const server = entries[0]!;
      const users = Array.isArray(server.users) ? server.users.filter(object) : [];
      ensure(users.length === 1, 'UNSUPPORTED', 'چند کاربر در یک outbound وجود دارد؛ JSON کامل حفظ شده است.');
      const user = users[0]!;
      p.server = str(server.address); p.serverPort = str(server.port); p.password = str(user.id);
      p.flow = str(user.flow); p.method = str(protocol === 'vless' ? user.encryption : user.security);
      p.alterId = str(user.alterId);
    } else {
      const entries = Array.isArray(settings.servers) ? settings.servers.filter(object) : [];
      ensure(entries.length === 1, 'UNSUPPORTED', rawOnly);
      const server = entries[0]!;
      p.server = str(server.address); p.serverPort = str(server.port); p.password = str(server.password);
      p.method = str(server.method); p.flow = str(server.flow);
      if (protocol === 'shadowsocks') {
        ensure(!str(server.plugin) && !truthy(server.uot), 'UNSUPPORTED', 'افزونه یا UoT در Shadowsocks فقط در JSON کامل حفظ می‌شود.');
      }
    }
    const tls = object(stream.tlsSettings) ? stream.tlsSettings : {};
    const reality = object(stream.realitySettings) ? stream.realitySettings : {};
    const ws = object(stream.wsSettings) ? stream.wsSettings : {};
    const grpc = object(stream.grpcSettings) ? stream.grpcSettings : {};
    const kcp = object(stream.kcpSettings) ? stream.kcpSettings : {};
    const quic = object(stream.quicSettings) ? stream.quicSettings : {};
    const upgrade = object(stream.httpupgradeSettings) ? stream.httpupgradeSettings : {};
    const http = object(stream.httpSettings) ? stream.httpSettings : {};
    const xhttp = object(stream.xhttpSettings) ? stream.xhttpSettings : {};
    p.sni = str(tls.serverName ?? reality.serverName);
    p.fingerPrint = str(tls.fingerprint ?? reality.fingerprint);
    p.alpn = Array.isArray(tls.alpn) ? tls.alpn.map(str).join(',') : str(tls.alpn);
    p.tlsAllowInsecure = str(tls.allowInsecure);
    p.publicKey = str(reality.publicKey); p.shortId = str(reality.shortId); p.spiderX = str(reality.spiderX);
    p.mldsa65Verify = str(reality.mldsa65Verify);
    p.ech = str(tls.echConfigList); p.pcs = str(tls.pinnedPeerCertSha256); p.vcn = str(tls.verifyPeerCertByName);
    switch (p.network) {
      case 'ws': p.path = str(ws.path); p.host = str(ws.host) || headerHost(ws.headers); break;
      case 'grpc': p.serviceName = str(grpc.serviceName); p.authority = str(grpc.authority); p.mode = truthy(grpc.multiMode) ? 'multi' : 'gun'; break;
      case 'kcp': p.seed = str(kcp.seed); p.headerType = str(object(kcp.header) ? kcp.header.type : ''); break;
      case 'quic': p.quicSecurity = str(quic.security); p.key = str(quic.key); p.headerType = str(object(quic.header) ? quic.header.type : ''); break;
      case 'httpupgrade': p.path = str(upgrade.path); p.host = str(upgrade.host); break;
      case 'xhttp': p.path = str(xhttp.path); p.host = str(xhttp.host); p.mode = str(xhttp.mode); p.xhttpExtra = object(xhttp.extra) ? JSON.stringify(xhttp.extra) : ''; break;
      case 'tcp': case 'raw': {
        const raw = object(stream.rawSettings) ? stream.rawSettings : object(stream.tcpSettings) ? stream.tcpSettings : {};
        const header = object(raw.header) ? raw.header : {};
        p.headerType = str(header.type);
        if (object(header.request)) {
          const request = header.request;
          const paths = Array.isArray(request.path) ? request.path : [];
          ensure(paths.length <= 1, 'UNSUPPORTED', rawOnly);
          p.path = str(paths[0]); p.host = headerHost(request.headers);
        }
        break;
      }
      case 'http': case 'h2': {
        const hosts = Array.isArray(http.host) ? http.host : [];
        ensure(hosts.length <= 1, 'UNSUPPORTED', 'چند میزبان HTTP در لینک اشتراک قابل نمایش نیست؛ JSON کامل حفظ شده است.');
        p.host = str(hosts[0]); p.path = str(http.path); p.headerType = 'none';
        break;
      }
    }
    const result = flatConfiguration({ ...p }, root, name);
    result.warnings.push('JSON، تنظیمات کامل برنامه را دارد؛ لینک اشتراک فقط اتصالِ یک outbound را توصیف می‌کند.');
    return result;
  } catch (error) {
    item.warnings.push(error instanceof DecodeError ? error.message : rawOnly);
    return item;
  }
}

export function validateShareUri(uri: string): Protocol {
  ensure(uri.length <= 1024 * 1024 && !/[\r\n\t]/.test(uri), 'FORMAT', 'لینک اشتراک معتبر نیست.');
  const match = /^(vless|vmess|trojan|ss):\/\/(.+)$/i.exec(uri);
  ensure(match, 'UNSUPPORTED', 'این پروتکل لینک پشتیبانی نمی‌شود.');
  const protocol = match[1]!.toLowerCase() as Protocol;
  if (protocol === 'vmess') {
    const value = parseJson(unbase64(uri.slice(8).split('#')[0]!));
    ensure(object(value) && !!str(value.add) && !!str(value.id), 'FORMAT', 'لینک VMess معتبر نیست.');
    port(value.port);
  } else if (protocol === 'ss') {
    const body = uri.slice(5).split('#')[0]!;
    const at = body.lastIndexOf('@');
    const decoded = at >= 0 ? `${new TextDecoder().decode(unbase64(body.slice(0, at)))}@${body.slice(at + 1)}` : new TextDecoder().decode(unbase64(body));
    const split = decoded.lastIndexOf('@');
    ensure(split > 0 && decoded.slice(0, split).includes(':'), 'FORMAT', 'لینک Shadowsocks معتبر نیست.');
    const target = decoded.slice(split + 1).split('/')[0]!;
    const end = endpoint({ address: target });
    void end;
  } else {
    let url: URL;
    try { url = new URL(uri); } catch { throw new DecodeError('FORMAT', 'لینک اشتراک معتبر نیست.'); }
    ensure(url.username && url.hostname, 'FORMAT', 'شناسه یا آدرس سرور در لینک موجود نیست.');
    port(url.port);
    const keys = [...url.searchParams.keys()];
    ensure(keys.length === new Set(keys).size, 'FORMAT', 'پارامتر تکراری در لینک وجود دارد.');
  }
  return protocol;
}

export function uriConfiguration(uri: string): ConfigItem {
  const protocol = validateShareUri(uri);
  const item: ConfigItem = { name: 'لینک اشتراک', protocol, uri, raw: { uri }, warnings: [] };
  if (protocol === 'vmess') {
    const value = parseJson(unbase64(uri.slice(8).split('#')[0]!));
    if (object(value)) { item.name = str(value.ps) || item.name; item.host = str(value.add); item.port = integer(value.port); item.transport = str(value.net); item.security = str(value.tls); }
  } else if (protocol === 'ss') {
    // ss URLs are not standard authorities; recover the endpoint the same way the validator does.
    try {
      const body = uri.slice(5).split('#')[0]!;
      const at = body.lastIndexOf('@');
      const decoded = new TextDecoder().decode(unbase64(at >= 0 ? body.slice(0, at) : body));
      const full = at >= 0 ? `${decoded}@${body.slice(at + 1)}` : decoded;
      const split = full.lastIndexOf('@');
      if (split > 0) {
        const end = endpoint({ address: full.slice(split + 1).split('/')[0]! });
        item.host = end.host;
        item.port = end.port;
      }
    } catch { /* the link remains usable even if the endpoint cannot be shown */ }
    const hashIndex = uri.indexOf('#');
    if (hashIndex >= 0) {
      try { item.name = decodeURIComponent(uri.slice(hashIndex + 1)) || item.name; }
      catch { item.name = uri.slice(hashIndex + 1) || item.name; }
    }
  } else {
    const url = new URL(uri);
    try { item.name = decodeURIComponent(url.hash.slice(1)) || item.name; } catch { item.name = url.hash.slice(1) || item.name; }
    item.host = url.hostname; item.port = integer(url.port);
    item.transport = url.searchParams.get('type') || 'tcp'; item.security = url.searchParams.get('security') || 'none';
  }
  return item;
}

/** Extract known export shapes without executing strings or contacting servers. */
export function extractConfigurations(root: Json): ConfigItem[] {
  const items: ConfigItem[] = [];
  const stack: Json[] = [root];
  const seen = new Set<string>();
  let visited = 0;
  const add = (item: ConfigItem) => {
    const key = item.uri || JSON.stringify(item.raw);
    if (!seen.has(key)) { seen.add(key); items.push(item); }
    ensure(items.length <= 2048, 'LIMIT', 'تعداد کانفیگ‌ها از حد مجاز بیشتر است.');
  };
  while (stack.length) {
    const value = stack.pop()!;
    ensure(++visited < 50000, 'LIMIT', 'ساختار فایل بیش از حد پیچیده است.');
    if (typeof value === 'string') {
      if (/^(vless|vmess|trojan|ss):\/\/\S+$/i.test(value.trim())) add(uriConfiguration(value.trim()));
      continue;
    }
    if (Array.isArray(value)) { for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]!); continue; }
    if (!object(value)) continue;
    const lockMetadata = (Object.hasOwn(value, 'isLocked') || Object.hasOwn(value, 'blockRootedAndJailbroken'))
      && !['v2rayProfile', 'outbounds', 'configType', 'sshConfig', 'v2rayJson'].some(key => Object.hasOwn(value, key));
    if (lockMetadata) continue;
    if (Array.isArray(value.outbounds)) {
      value.outbounds.forEach((outbound, index) => {
        if (object(outbound)) { const item = outboundConfiguration(outbound, value, index); if (item) add(item); }
      });
      continue;
    }
    if (object(value.v2rayProfile)) {
      add(flatConfiguration(value.v2rayProfile, value, str(value.name), str(value.address)));
      for (const [key, child] of Object.entries(value)) if (!['v2rayProfile', 'name', 'address'].includes(key)) stack.push(child);
      continue;
    }
    if (Object.hasOwn(value, 'configType') && (Object.hasOwn(value, 'server') || Object.hasOwn(value, 'password'))) {
      add(flatConfiguration(value, value)); continue;
    }
    if (object(value.sshConfig)) { add({ name: str(value.name) || 'SSH', protocol: 'ssh', raw: value, warnings: ['SSH لینک اشتراک استاندارد ندارد؛ تنظیمات خام حفظ شده است.'] }); continue; }
    if (typeof value.v2rayJson === 'string') { stack.push(parseJson(value.v2rayJson)); continue; }
    if (object(value.v2rayJson)) { stack.push(value.v2rayJson); continue; }
    const children = Object.entries(value).filter(([, child]) => typeof child === 'object' && child !== null || typeof child === 'string' && /^(vless|vmess|trojan|ss):\/\//i.test(child));
    if (children.length) { for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]![1]); }
    else add({ name: str(value.remarks) || str(value.name) || 'دادهٔ بازیابی‌شده', protocol: 'other', raw: value, warnings: ['ساختار کانفیگ ناشناخته است؛ دادهٔ خام بدون حذف نمایش داده شده است.'] });
  }
  ensure(items.length > 0, 'EMPTY', 'کانفیگی داخل فایل پیدا نشد.');
  return items;
}
