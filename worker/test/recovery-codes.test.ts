import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptRecoveryCode,
  encryptRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from '../src/services/recoveryCodes';

const env = { RECOVERY_PEPPER: 'test_recovery_pepper_do_not_use_in_production' } as any;

test('recovery codes encrypt and decrypt for the owning user only', async () => {
  const code = 'ABCD-EFGH-JKMN-PQRS';
  const payload = await encryptRecoveryCode(env, 'x-user-1', code);

  assert.equal(await decryptRecoveryCode(env, 'x-user-1', payload), code);
  assert.equal(await decryptRecoveryCode(env, 'x-user-2', payload), null);
  assert.equal(await decryptRecoveryCode(env, 'x-user-1', null), null);
});

test('recovery-code hashes are scoped per user', async () => {
  const first = await hashRecoveryCode(env, 'ABCDEFGH12345678', 'x-user-1');
  const second = await hashRecoveryCode(env, 'ABCDEFGH12345678', 'x-user-2');
  const legacy = await hashRecoveryCode(env, 'ABCDEFGH12345678');

  assert.notEqual(first, second);
  assert.notEqual(first, legacy);
});

test('normalizes recovery-code input', () => {
  assert.equal(normalizeRecoveryCode('abcd-efgh-jkmn-pqrs'), 'ABCDEFGHJKMNPQRS');
  assert.equal(normalizeRecoveryCode('ABCD EFGH IJKL MNOP'), 'ABCDEFGH1JK1MN0P');
  assert.equal(normalizeRecoveryCode('too-short'), null);
});
