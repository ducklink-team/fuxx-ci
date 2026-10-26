import test from 'node:test';
import assert from 'node:assert/strict';
import { controllaHeader, controllaUrl } from '../header.mjs';
import { licenzaConsentita, analizzaLicenze } from '../licenze.mjs';
import { eseguiRevisione } from '../revisione.mjs';

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
test('adattatore revisione: niente revisione facoltativa e OK legato allo SHA', () => {
  const r = eseguiRevisione('revisione-ai.mjs', 'abc', { OPENROUTER_API_KEY: 'finta' }, (_cmd, _args, opts) => {
    assert.equal(opts.env.REVISIONE_FACOLTATIVA, '0');
    assert.equal(opts.env.FUXX_OPENROUTER_FINTO, undefined);
    return { status: 0, stdout: 'costo revisione', stderr: '' };
  });
  assert.deepEqual(r, { verdetto: 'OK', sha: 'abc' });
});
test('adattatore revisione: BLOCK non diventa OK', () => assert.equal(eseguiRevisione('ai.mjs', 'abc', { OPENROUTER_API_KEY: 'finta' }, () => ({ status: 1, stdout: '', stderr: 'BLOCK src/a:1' })).verdetto, 'BLOCK'));
test('adattatore revisione: chiave mancante non consente merge', () => assert.throws(() => eseguiRevisione('ai.mjs', 'abc', {}, () => ({ status: 0 })), /chiave/));
