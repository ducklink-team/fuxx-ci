import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/audit-npm.mjs');

function esegui({ vulnerabilita, eccezioni, oggi = '2026-11-17' }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-npm-'));
  try {
    const audit = path.join(dir, 'audit.json');
    writeFileSync(audit, JSON.stringify({ vulnerabilities: vulnerabilita }), 'utf8');
    if (eccezioni !== undefined) {
      mkdirSync(path.join(dir, '.fuxx'), { recursive: true });
      writeFileSync(path.join(dir, '.fuxx', 'audit-eccezioni.json'), JSON.stringify(eccezioni), 'utf8');
    }
    return spawnSync(process.execPath, [script, '--da-file', audit], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, AUDIT_NPM_OGGI: oggi },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const high = (url = 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc') => ({
  severity: 'high',
  via: [{ source: 1, url, severity: 'high', title: 'test' }],
  fixAvailable: false,
});

test('senza eccezioni un high restituisce 1', () => {
  const r = esegui({ vulnerabilita: { picomatch: high() } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /GHSA-aaaa-bbbb-cccc.*picomatch.*high/is);
});

test('un’eccezione valida ignora il finding e stampa la scadenza', () => {
  const r = esegui({
    vulnerabilita: { picomatch: high() },
    eccezioni: [{ id: 'GHSA-aaaa-bbbb-cccc', scadenza: '2026-12-01', motivo: 'fix=null' }],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /GHSA-aaaa-bbbb-cccc.*2026-12-01/is);
});

test('un’eccezione scaduta restituisce 1', () => {
  const r = esegui({
    vulnerabilita: { picomatch: high() },
    eccezioni: [{ id: 'GHSA-aaaa-bbbb-cccc', scadenza: '2026-11-16', motivo: 'fix=null' }],
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /scaduta/);
});

test('un high con altro id non in eccezione restituisce 1', () => {
  const r = esegui({
    vulnerabilita: { picomatch: high('https://github.com/advisories/GHSA-dddd-eeee-ffff') },
    eccezioni: [{ id: 'GHSA-aaaa-bbbb-cccc', scadenza: '2026-12-01', motivo: 'altro' }],
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /GHSA-dddd-eeee-ffff/i);
});

test('solo moderate restituisce 0', () => {
  const r = esegui({ vulnerabilita: { next: { severity: 'moderate', via: [{ source: 1, url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'moderate' }] } } });
  assert.equal(r.status, 0, r.stderr);
});

test('eccezione malformata restituisce 1 con messaggio chiaro', () => {
  const r = esegui({ vulnerabilita: {}, eccezioni: [{ id: 'CVE-2026-1', scadenza: '2027-01-01', motivo: '' }] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /eccezione.*id.*GHSA|motivo.*vuoto/i);
});

test('data impossibile o oltre 90 giorni restituisce 1', () => {
  for (const scadenza of ['2026-02-30', '2027-02-20']) {
    const r = esegui({ vulnerabilita: {}, eccezioni: [{ id: 'GHSA-aaaa-bbbb-cccc', scadenza, motivo: 'test' }] });
    assert.equal(r.status, 1, scadenza);
    assert.match(r.stderr, /non valida|oltre 90 giorni/);
  }
});

test('un pacchetto transitivo sostenuto solo da avvisi ignorati non conta', () => {
  const r = esegui({
    vulnerabilita: {
      radice: high(),
      transitivo: { severity: 'high', via: ['radice'], fixAvailable: false },
    },
    eccezioni: [{ id: 'GHSA-aaaa-bbbb-cccc', scadenza: '2026-12-01', motivo: 'nessuna correzione' }],
  });
  assert.equal(r.status, 0, r.stderr);
});
