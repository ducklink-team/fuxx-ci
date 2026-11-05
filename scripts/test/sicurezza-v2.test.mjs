import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as licenze from '../licenze.mjs';

const leggi = relativo => readFileSync(new URL(relativo, import.meta.url), 'utf8');

// Rilievo 0002: nomi e licenze di terzi non devono produrre markdown nel riepilogo.
test('riepilogo licenze: link, immagini, HTML e a capo restano dentro il blocco recintato', () => {
  assert.equal(typeof licenze.riepilogo, 'function');
  const avvisi = [
    { nome: '[pagina](https://evil.example) ![t](https://track.example/p.png)', licenza: 'GPL-3.0`\n# Titolo <img src=x>' },
    { nome: 'x\u2028y', licenza: 'UNKNOWN' },
  ];
  const testo = licenze.riepilogo(3, avvisi);
  assert.equal((testo.match(/^```/gm) ?? []).length, 2);
  const fuori = testo.replace(/```text\n[\s\S]*?\n```/, '');
  assert.doesNotMatch(fuori, /evil|track|Titolo|img|pagina/);
  assert.equal(testo.includes('\u2028'), false);
});

// Rilievo 0001: l'esempio del progetto non deve contenere una revisione che esegue codice della PR con la chiave.
test('esempio di progetto: nessun job di revisione con la chiave e nessuno script della PR', () => {
  const ci = leggi('../../esempi/ci-progetto.yml');
  assert.doesNotMatch(ci, /OPENROUTER|revisione-ai|revisione\.mjs/);
});

test('esempio di merge: modo commento-revisore e script della versione v2', () => {
  const merge = leggi('../../esempi/merge-progetto.yml');
  assert.match(merge, /modo: commento-revisore/);
  assert.match(merge, /versione-ci: v2/);
});

// Rilievi 0003 e 0004: niente soppressioni inserite dalla PR negli scanner.
test('sicurezza: semgrep ignora nosemgrep e gitignore; gitleaks usa una config scritta dal workflow e ignora gitleaks:allow', () => {
  const s = leggi('../../.github/workflows/sicurezza.yml');
  for (const flag of ['--disable-nosem', '--no-git-ignore', '--ignore-gitleaks-allow', '--config "$RUNNER_TEMP/gitleaks-fuxx.toml"', 'useDefault = true']) {
    assert.ok(s.includes(flag), `manca ${flag}`);
  }
});
