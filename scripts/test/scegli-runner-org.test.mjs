import test from 'node:test';
import assert from 'node:assert/strict';
import { leggiRunnerOrg, scegliRunner } from '../scegli-runner.mjs';

const orgRunner = (busy = false, status = 'online') => ({
  name: 'pcvecchio-org-1',
  status,
  busy,
  labels: [{ name: 'self-hosted' }, { name: 'fuxx-org' }, { name: 'pcvecchio' }],
});
const org = 'ducklink-team';
const fallback = '["self-hosted","pcvecchio"]';

test('sceglie il runner org online e libero', () => {
  assert.equal(scegliRunner({
    token: 'token', runners: [], runnersOrg: [orgRunner()], fallback, nomeRepo: 'gestionale',
  }), '["self-hosted","fuxx-org"]');
});

test('sceglie il runner org online anche occupato', () => {
  assert.equal(scegliRunner({
    token: 'token', runners: [], runnersOrg: [orgRunner(true)], fallback, nomeRepo: 'gestionale',
  }), '["self-hosted","fuxx-org"]');
});

test('lettura org fallita con repo vuoto usa il fallback', () => {
  assert.equal(scegliRunner({ token: 'token', runners: [], runnersOrg: undefined, fallback, nomeRepo: 'gestionale' }), fallback);
});

test('il runner personale conserva la precedenza', () => {
  assert.equal(scegliRunner({
    token: 'token',
    runners: [{ name: 'pc-111_FUXX_SETUP-g1', status: 'online', busy: false }],
    runnersOrg: undefined,
    fallback,
    nomeRepo: '111_FUXX_SETUP',
  }), '["self-hosted","fuxx-pc"]');
});

test('runner org offline non viene scelto prima di fuxx-ci', () => {
  assert.equal(scegliRunner({
    token: 'token',
    runners: [{ status: 'online', busy: true, labels: [{ name: 'fuxx-ci' }] }],
    runnersOrg: [orgRunner(false, 'offline')],
    fallback,
    nomeRepo: 'gestionale',
  }), '["self-hosted","fuxx-ci"]');
});

test('leggiRunnerOrg restituisce undefined per 403 e i runner per 200', async () => {
  const precedente = process.env.GITHUB_API_URL;
  process.env.GITHUB_API_URL = 'https://api.github.test';
  try {
    const risposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
    const negato = await leggiRunnerOrg(org, 'token', async () => risposta(403, {}));
    const runner = orgRunner();
    const riuscito = await leggiRunnerOrg(org, 'token', async () => risposta(200, { runners: [runner] }));
    assert.equal(negato, undefined);
    assert.deepEqual(riuscito, [runner]);
  } finally {
    if (precedente === undefined) delete process.env.GITHUB_API_URL;
    else process.env.GITHUB_API_URL = precedente;
  }
});
