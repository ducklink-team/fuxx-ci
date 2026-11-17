import test from 'node:test';
import assert from 'node:assert/strict';
import { leggiCommentoRevisore } from '../merge.mjs';

const sha = 'a'.repeat(40);
const base = 'c'.repeat(40);
const corpo = `ESITO: OK\nnota del revisore\nSHA: ${sha}\nBase: ${base}`;

function commento(campi = {}) {
  return { user: { login: 'doubledrag33' }, body: corpo, ...campi };
}

test('commento non modificato: il verdetto resta valido', () => {
  assert.equal(leggiCommentoRevisore([commento({ created_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-17T10:00:00Z' })], sha, base), 'OK');
});

for (const campi of [
  { created_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-17T10:01:00Z' },
  { createdAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-17T10:01:00Z' },
  { createdAt: '2026-11-17T10:00:00Z', lastEditedAt: '2026-11-17T10:01:00Z' },
]) {
  test('commento modificato dopo la creazione: non è valido', () => {
    assert.equal(leggiCommentoRevisore([commento(campi)], sha, base), 'MODIFICATO');
  });
}

test('commento con SHA diverso: non è valido', () => {
  assert.equal(leggiCommentoRevisore([commento({ body: corpo.replace(sha, 'b'.repeat(40)) })], sha, base), 'SCONOSCIUTA');
});

test('commento assente: non è valido', () => {
  assert.equal(leggiCommentoRevisore([], sha, base), 'SCONOSCIUTA');
});
