import test from 'node:test';
import assert from 'node:assert/strict';
import { scegliRunner } from '../scegli-runner.mjs';

const ubuntu = '"ubuntu-latest"';
const selfHosted = '["self-hosted","fuxx-pc"]';

test('una PR da fork usa ubuntu anche con token e runner libero', () => {
  assert.equal(scegliRunner({
    fork: true,
    token: 'token-da-non-stampare',
    runners: [{ name: 'pc-progetto', status: 'online', busy: false }],
    fallback: selfHosted,
    nomeRepo: 'progetto',
  }), ubuntu);
});

test('senza token conserva il fallback e usa ubuntu se il fallback è vuoto', () => {
  assert.equal(scegliRunner({ token: '', fallback: selfHosted, nomeRepo: 'progetto' }), selfHosted);
  assert.equal(scegliRunner({ token: undefined, fallback: '', nomeRepo: 'progetto' }), ubuntu);
});

test('un runner del repository online e libero seleziona il runner self-hosted', () => {
  assert.equal(scegliRunner({
    token: 'segreto',
    runners: [{ name: 'pc-progetto-01', status: 'online', busy: false }],
    fallback: ubuntu,
    nomeRepo: 'progetto',
  }), selfHosted);
});

test('runner occupato, offline o con nome diverso usa ubuntu', () => {
  for (const runner of [
    { name: 'pc-progetto', status: 'online', busy: true },
    { name: 'pc-progetto', status: 'offline', busy: false },
    { name: 'pc-altro', status: 'online', busy: false },
  ]) {
    assert.equal(scegliRunner({ token: 'segreto', runners: [runner], fallback: selfHosted, nomeRepo: 'progetto' }), ubuntu);
  }
});

test('risposta API assente o illeggibile usa ubuntu', () => {
  assert.equal(scegliRunner({ token: 'segreto', runners: null, fallback: selfHosted, nomeRepo: 'progetto' }), ubuntu);
  assert.equal(scegliRunner({ token: 'segreto', runners: {}, fallback: selfHosted, nomeRepo: 'progetto' }), ubuntu);
});

test('l output della scelta non contiene mai il token', () => {
  const token = 'segreto-da-non-visualizzare';
  const output = scegliRunner({
    token,
    runners: [{ name: 'pc-progetto', status: 'online', busy: false }],
    fallback: ubuntu,
    nomeRepo: 'progetto',
  });
  assert.equal(output.includes(token), false);
});
