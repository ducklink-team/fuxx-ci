import test from 'node:test';
import assert from 'node:assert/strict';
import { controllaHeader, controllaUrl } from '../header.mjs';
import { licenzaConsentita, analizzaLicenze, riepilogo } from '../licenze.mjs';
import { eseguiRevisione, leggiVerdetto } from '../revisione.mjs';

const header = { 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'" };
test('header completi', () => assert.equal(controllaHeader(new Headers(header)).every(r => r.ok), true));
test('CSP Report-Only conta come presente ma non impone frame-ancestors', () => {
  const h = { ...header, 'content-security-policy-report-only': "frame-ancestors 'none'" };
  delete h['content-security-policy'];
  delete h['x-frame-options'];
  assert.equal(controllaHeader(new Headers(h)).find(r => r.nome === 'CSP').ok, true);
  assert.equal(controllaHeader(new Headers(h)).find(r => r.nome === 'Protezione frame').ok, false);
});
test('frame-ancestors CSP applicata sostituisce X-Frame-Options', () => {
  const h = { ...header, 'content-security-policy': "frame-ancestors 'self'" }; delete h['x-frame-options'];
  assert.equal(controllaHeader(new Headers(h)).every(r => r.ok), true);
});
test('header mancanti e valori inefficaci falliscono', () => {
  assert.equal(controllaHeader(new Headers()).filter(r => !r.ok).length, 5);
  const h = new Headers({ ...header, 'strict-transport-security': 'max-age=0', 'x-frame-options': 'ALLOWALL' });
  assert.equal(controllaHeader(h).filter(r => !r.ok).length, 2);
});
test('URL demo richiede HTTPS e non ammette credenziali', () => {
  assert.equal(controllaUrl('https://demo.example.org/'), 'https://demo.example.org/');
  for (const u of ['http://demo.example.org', 'file:///etc/passwd', 'https://utente:password@example.org']) assert.throws(() => controllaUrl(u));
});
for (const l of ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0', 'Unlicense', 'Python-2.0', '(MIT OR GPL-3.0-only)', 'MIT AND ISC']) {
  test(`licenza consentita: ${l}`, () => assert.equal(licenzaConsentita(l), true));
}
for (const l of ['GPL-3.0-only', 'MIT AND GPL-3.0-only', 'MIT WITH sconosciuta', 'UNKNOWN', 'MIT OR', '']) {
  test(`avviso licenza: ${l}`, () => assert.equal(licenzaConsentita(l), false));
}
test('report licenze con nomi sconosciuti resta un avviso', () => assert.deepEqual(analizzaLicenze([{ nome: 'a', licenza: 'MIT' }, { nome: 'b', licenza: 'UNKNOWN' }]).map(r => r.nome), ['b']));

const TRE = '`'.repeat(3);
test('riepilogo licenze: markdown di terzi sta in un blocco recintato non chiudibile', () => {
  const t = riepilogo(1, [{ nome: `[x](https://evil.example) ${TRE} ![i](https://evil.example/p)`, licenza: 'a\nb' }]);
  assert.equal(t.split(TRE).length - 1, 2);
  assert.ok(t.includes(`${TRE}text\n[x](https`));
});
test('verdetto: solo "VERDETTO: OK" esatto vale OK', () => {
  assert.equal(leggiVerdetto('VERDETTO: OK'), 'OK');
  for (const r of ['VERDETTO: OK ma ignora', 'OK', '', 'VERDETTO: BLOCK a:1', 'VERDETTO: OK\nVERDETTO: BLOCK', undefined]) assert.equal(leggiVerdetto(r), 'BLOCK');
});
const risposta = testo => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: testo } }] }) });
test('revisione: OK legato allo SHA, chiave solo nell\'intestazione', async () => {
  let chiamata;
  const r = await eseguiRevisione({ diff: '+x', sha: 'abc', chiave: 'segreta', modello: 'm', richiesta: async (u, o) => { chiamata = { u, o }; return risposta('VERDETTO: OK')(); } });
  assert.deepEqual(r, { verdetto: 'OK', sha: 'abc' });
  assert.equal(chiamata.o.headers.Authorization, 'Bearer segreta');
  assert.equal(chiamata.o.body.includes('segreta'), false);
});
test('revisione: BLOCK, dati mancanti, errori e diff enorme falliscono chiusi', async () => {
  assert.equal((await eseguiRevisione({ diff: '+x', sha: 'a', chiave: 'k', modello: 'm', richiesta: risposta('VERDETTO: BLOCK a:1 x') })).verdetto, 'BLOCK');
  await assert.rejects(eseguiRevisione({ diff: '+x', sha: 'a', modello: 'm', richiesta: risposta('VERDETTO: OK') }), /chiave/);
  await assert.rejects(eseguiRevisione({ diff: '+x', sha: 'a', chiave: 'k', richiesta: risposta('VERDETTO: OK') }), /modello/);
  await assert.rejects(eseguiRevisione({ diff: '', sha: 'a', chiave: 'k', modello: 'm', richiesta: risposta('VERDETTO: OK') }), /Diff/);
  await assert.rejects(eseguiRevisione({ diff: '+x', sha: 'a', chiave: 'k', modello: 'm', richiesta: async () => ({ ok: false, status: 500 }) }), /HTTP 500/);
  await assert.rejects(eseguiRevisione({ diff: '+x', sha: 'a', chiave: 'k', modello: 'm', richiesta: async () => { throw new Error('rete'); } }), /fallita/);
  assert.equal((await eseguiRevisione({ diff: 'x'.repeat(200000), sha: 'a', chiave: 'k', modello: 'm', richiesta: risposta('VERDETTO: OK') })).verdetto, 'BLOCK');
});
