import test from 'node:test';
import assert from 'node:assert/strict';
import { ghReale } from '../merge.mjs';

const args = ['api', 'repos/org/progetto/pulls/7'];

test('ghReale ricava HTTP 404 da stderr anche con exit code diverso', () => {
  const errore = new Error('errore remoto non esposto');
  errore.status = 1;
  errore.stderr = 'gh: Not Found (HTTP 404)';

  assert.throws(() => ghReale(args, () => { throw errore; }), ricevuto => {
    assert.equal(ricevuto.status, 404);
    assert.match(ricevuto.message, /HTTP 404/);
    return true;
  });
});

test('ghReale non interpreta l exit code come stato HTTP senza HTTP in stderr', () => {
  const errore = new Error('timeout remoto non esposto');
  errore.status = 1;
  errore.stderr = 'gh: request timed out';

  assert.throws(() => ghReale(args, () => { throw errore; }), ricevuto => {
    assert.equal(ricevuto.status, undefined);
    assert.doesNotMatch(ricevuto.message, /HTTP 1/);
    assert.doesNotMatch(ricevuto.message, /timeout remoto non esposto|request timed out/);
    return true;
  });
});
