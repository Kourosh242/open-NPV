import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeContainer, inspectContainer } from '../src/core/index.js';
import { gen2A16, whiteboxCTR } from '../src/core/whitebox.js';
import { extractConfigurations, validateShareUri } from '../src/core/convert.js';
import { base64, parseJson, redact, safeFilename, unbase64, utf8 } from '../src/core/utils.js';
import type { Json } from '../src/core/types.js';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url)));
const json = (name: string): Json => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), 'utf8')) as Json;
const hex = (value: string) => Uint8Array.from(value.match(/../g) || [], x => parseInt(x, 16));
const toHex = (value: Uint8Array) => Buffer.from(value).toString('hex');

test('gen-2 white-box: 24 independent Go reference vectors', () => {
  for (const [salt, expected] of json('gen2-vectors.json') as string[][]) {
    assert.equal(toHex(gen2A16(hex(salt!))), expected);
  }
});

test('all CTR variants: 120 Go vectors, including partial blocks and counter carry', () => {
  for (const v of json('ctr-vectors.json') as Array<Record<string, string>>) {
    assert.equal(toHex(whiteboxCTR(hex(v.nonce!), hex(v.input!), v.variant as 'npvt' | 'v1' | 'v2')), v.output);
  }
});

for (const [name, password] of [
  ['synthetic.npvt', ''],
  ['synthetic-v5-app.npvs', ''],
  ['synthetic-v5-pass.npvs', 'رمز آزمایشی 123'],
  ['synthetic-v1-app-v1.npvs', ''],
  ['synthetic-v1-app-v2.npvs', ''],
  ['synthetic-v1-pass.npvs', 'synthetic password'],
] as const) {
  test(`Go-generated container roundtrip: ${name}`, () => {
    const bytes = fixture(name);
    const result = decodeContainer(bytes, password);
    const expected = json(`${name}.json`) as Json[];
    assert.equal(result.configs.length, expected.length);
    assert.deepEqual(result.configs.map(c => c.raw), expected);
    assert.equal(result.configs.filter(c => c.uri).length, 5);
    assert.deepEqual(result.configs.map(c => c.protocol), ['vless', 'vless', 'vmess', 'ss', 'trojan']);
    for (const config of result.configs) if (config.uri) validateShareUri(config.uri);
  });
}

test('password-protected containers never derive a key without a password', () => {
  for (const name of ['synthetic-v5-pass.npvs', 'synthetic-v1-pass.npvs']) {
    assert.equal(inspectContainer(fixture(name)).requiresPassword, true);
    assert.throws(() => decodeContainer(fixture(name)), { code: 'PASSWORD_REQUIRED' });
    assert.throws(() => decodeContainer(fixture(name), 'wrong'), { code: 'BAD_PASSWORD' });
  }
});

test('AEAD rejects a single flipped ciphertext bit', () => {
  const bytes = fixture('synthetic-v5-app.npvs');
  bytes[bytes.length - 80] = bytes[bytes.length - 80]! ^ 1;
  assert.throws(() => decodeContainer(bytes), { code: 'INTEGRITY' });
});

test('truncated and mislabeled files fail explicitly', () => {
  assert.throws(() => decodeContainer(fixture('synthetic-v5-app.npvs').slice(0, -1)), { code: 'FORMAT' });
  assert.throws(() => decodeContainer(utf8('not a config')), { code: 'FORMAT' });
  assert.throws(() => decodeContainer(utf8('NPVT1\n')), { code: 'EMPTY' });
});

test('VLESS keeps host/sni, IPv6, REALITY empty sid and encoded path separate', () => {
  const configs = (json('synthetic-v5-app.npvs.json') as Json[]);
  const result = extractConfigurations(configs);
  const ws = new URL(result[0]!.uri!);
  assert.equal(ws.searchParams.get('host'), 'front.example.invalid');
  assert.equal(ws.searchParams.get('sni'), 'sni.example.invalid');
  assert.equal(ws.searchParams.get('path'), '/a?b=1&c=2');
  const reality = new URL(result[1]!.uri!);
  assert.equal(reality.hostname, '[2001:db8::1]');
  assert.equal(reality.port, '8443');
  assert.equal(reality.searchParams.get('sid'), '');
  assert.equal(reality.searchParams.get('flow'), 'xtls-rprx-vision');
  const ss = result[3]!.uri!;
  const user = ss.slice(5).split('@')[0]!;
  assert.equal(Buffer.from(user, 'base64url').toString('utf8'), 'aes-256-gcm:p@ss:/?# тест');
});

test('full Xray outbound conversion retains original JSON', () => {
  const root = {
    remarks: 'Xray', outbounds: [{ protocol: 'vless', tag: 'edge', settings: { vnext: [{ address: '2001:db8::2', port: 443, users: [{ id: '11111111-2222-4333-8444-555555555555', encryption: 'none', flow: 'xtls-rprx-vision' }] }] }, streamSettings: { network: 'tcp', security: 'reality', realitySettings: { serverName: 'www.example.invalid', fingerprint: 'chrome', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', shortId: '' } } }], routing: { domainStrategy: 'AsIs' },
  };
  const result = extractConfigurations(root);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.raw, root);
  assert.equal(new URL(result[0]!.uri!).searchParams.get('sid'), '');
});

test('unsupported connection features produce raw JSON, not a lossy link', () => {
  const root = { outbounds: [{ protocol: 'vless', settings: { vnext: [{ address: 'example.invalid', port: 443, users: [{ id: 'test' }] }] }, streamSettings: { network: 'tcp', finalmask: { tcp: [{ type: 'fragment' }] } } }] };
  const result = extractConfigurations(root);
  assert.equal(result[0]!.uri, undefined);
  assert.deepEqual(result[0]!.raw, root);
  assert.ok(result[0]!.warnings.length);
});

test('NPVO1 and npvs1 sentinels decode without executing content', () => {
  const data = { configs: [{ name: 'Open', v2rayProfile: { configType: 5, server: 'npvs1:' + base64(utf8('example.invalid')), serverPort: 443, password: 'test', network: 'tcp', security: 'none' } }] };
  const result = decodeContainer(utf8('NPVO1\n' + JSON.stringify(data)));
  assert.equal(result.configs[0]!.host, 'example.invalid');
  assert.equal(result.authenticated, false);
});

test('redaction also masks share-link strings embedded in raw JSON', () => {
  const raw = { uri: 'vless://11111111-2222-4333-8444-555555555555@example.invalid:443?sid=abc#name', nested: { link: 'vmess://eyJpZCI6InNlY3JldCJ9' } };
  const masked = redact(raw) as { uri: string; nested: { link: string } };
  assert.ok(!masked.uri.includes('11111111'));
  assert.ok(!masked.uri.includes('sid=abc'));
  assert.ok(masked.nested.link.startsWith('vmess://••••'));
});

test('lock-policy metadata is skipped without dropping a locked configuration wrapper', () => {
  const config = { isLocked: true, name: 'kept', v2rayProfile: { configType: 5, server: 'example.invalid', serverPort: 443, password: 'test', network: 'tcp', security: 'none' } };
  const result = extractConfigurations([{ isLocked: false, blockRootedAndJailbroken: true }, config]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.name, 'kept');
  assert.ok(result[0]!.uri);
});

test('HTTP/h2 outbounds read httpSettings rather than inventing a TCP header', () => {
  const root = { outbounds: [{ protocol: 'vless', settings: { vnext: [{ address: 'example.invalid', port: 443, users: [{ id: 'test', encryption: 'none' }] }] }, streamSettings: { network: 'h2', security: 'tls', httpSettings: { host: ['front.example.invalid'], path: '/feed' }, tlsSettings: { serverName: 'sni.example.invalid' } } }] };
  const result = extractConfigurations(root);
  const url = new URL(result[0]!.uri!);
  assert.equal(url.searchParams.get('type'), 'h2');
  assert.equal(url.searchParams.get('host'), 'front.example.invalid');
  assert.equal(url.searchParams.get('path'), '/feed');
  assert.equal(url.searchParams.get('sni'), 'sni.example.invalid');
});

test('strict Base64, JSON limits, redaction and safe filenames', () => {
  assert.deepEqual(unbase64(base64(utf8('سلام'), true)), utf8('سلام'));
  assert.throws(() => unbase64('A'), { code: 'FORMAT' });
  assert.throws(() => unbase64('aa+_'), { code: 'FORMAT' });
  assert.throws(() => parseJson('['.repeat(100) + '0' + ']'.repeat(100)), { code: 'LIMIT' });
  assert.deepEqual(redact({ id: 'secret', nested: { password: 'secret2', keep: 'visible' } }), { id: '••••••••', nested: { password: '••••••••', keep: 'visible' } });
  assert.equal(safeFilename('../../secret.npvs'), 'secret');
  const pollute = parseJson('{"__proto__":{"polluted":true},"constructor":{"x":1}}');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.ok(pollute);
});
