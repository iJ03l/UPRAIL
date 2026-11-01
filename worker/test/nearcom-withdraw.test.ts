import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getNearcomDestination,
  parseNearcomAddress,
  saveNearcomDestination,
} from '../src/services/nearcomWithdraw';

function createMemoryNearcomDb() {
  const rows = new Map<
    string,
    {
      x_id: string;
      x_handle: string;
      nearcom_address: string;
      intents_account_id: string;
      created_at: number;
      updated_at: number;
    }
  >();

  return {
    rows,
    prepare(sql: string) {
      const statement = {
        args: [] as unknown[],
        bind(...args: unknown[]) {
          statement.args = args;
          return statement;
        },
        async run() {
          if (sql.includes('INSERT INTO nearcom_withdraw_destinations')) {
            const [xId, xHandle, nearcomAddress, intentsAccountId, createdAt, updatedAt] =
              statement.args as [string, string, string, string, number, number];
            const existing = rows.get(xId);
            rows.set(xId, {
              x_id: xId,
              x_handle: xHandle,
              nearcom_address: nearcomAddress,
              intents_account_id: intentsAccountId,
              created_at: existing?.created_at || createdAt,
              updated_at: updatedAt,
            });
          }
          return { meta: { changes: 1 } };
        },
        async first<T>() {
          if (sql.includes('FROM nearcom_withdraw_destinations')) {
            const [xId] = statement.args as string[];
            return (rows.get(xId) as T) || null;
          }
          return null;
        },
      };
      return statement;
    },
  };
}

describe('parseNearcomAddress', () => {
  it('parses and normalizes nearcom:0x... internal addresses', () => {
    const parsed = parseNearcomAddress('nearcom:0xb137a2f1054b5de422a8df801613d6722701163c');
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.nearcomAddress, 'nearcom:0xb137a2f1054b5de422a8df801613d6722701163c');
      assert.equal(parsed.intentsAccountId, '0xb137a2f1054b5de422a8df801613d6722701163c');
    }
  });

  it('lowercases checksummed nearcom:0x... and bare 0x... addresses', () => {
    const mixed = parseNearcomAddress('  NEARCOM:0xB137A2F1054B5DE422A8DF801613D6722701163C ');
    assert.equal(mixed.ok, true);
    if (mixed.ok) {
      assert.equal(mixed.nearcomAddress, 'nearcom:0xb137a2f1054b5de422a8df801613d6722701163c');
      assert.equal(mixed.intentsAccountId, '0xb137a2f1054b5de422a8df801613d6722701163c');
    }

    const bare = parseNearcomAddress('0xB137A2F1054B5DE422A8DF801613D6722701163C');
    assert.equal(bare.ok, true);
    if (bare.ok) {
      assert.equal(bare.nearcomAddress, 'nearcom:0xb137a2f1054b5de422a8df801613d6722701163c');
      assert.equal(bare.intentsAccountId, '0xb137a2f1054b5de422a8df801613d6722701163c');
    }
  });

  it('accepts named .near accounts and 64-hex implicit accounts', () => {
    const named = parseNearcomAddress('nearcom:alice.near');
    assert.equal(named.ok, true);
    if (named.ok) {
      assert.equal(named.nearcomAddress, 'nearcom:alice.near');
      assert.equal(named.intentsAccountId, 'alice.near');
    }

    const hex64 = 'a'.repeat(64);
    const implicit = parseNearcomAddress(hex64);
    assert.equal(implicit.ok, true);
    if (implicit.ok) {
      assert.equal(implicit.nearcomAddress, `nearcom:${hex64}`);
      assert.equal(implicit.intentsAccountId, hex64);
    }
  });

  it('rejects UPRAIL system and escrow vault addresses', () => {
    for (const forbidden of [
      'nearcom:intents.near',
      'intents.near',
      'escrow.uprail.near',
      'nearcom:user123.escrow.uprail.near',
    ]) {
      const res = parseNearcomAddress(forbidden);
      assert.equal(res.ok, false, `Expected ${forbidden} to be rejected`);
    }
  });

  it('rejects malformed addresses and X handles', () => {
    for (const invalid of ['', '   ', 'nearcom:', '@uprailworld', '0x12345', 'solana:abc']) {
      const res = parseNearcomAddress(invalid);
      assert.equal(res.ok, false, `Expected "${invalid}" to be rejected`);
    }
  });
});

describe('nearcom destination storage', () => {
  it('returns null before setup and persists updates per user', async () => {
    const db = createMemoryNearcomDb();
    const env = { DB: db } as any;

    const initial = await getNearcomDestination(env, 'x-user-1');
    assert.equal(initial, null);

    const saved = await saveNearcomDestination(env, {
      xId: 'x-user-1',
      xHandle: 'uprailworld',
      rawAddress: 'nearcom:0xb137a2f1054b5de422a8df801613d6722701163c',
    });

    assert.equal(saved.ok, true);
    if (saved.ok) {
      assert.equal(
        saved.destination.nearcomAddress,
        'nearcom:0xb137a2f1054b5de422a8df801613d6722701163c'
      );
      assert.equal(
        saved.destination.intentsAccountId,
        '0xb137a2f1054b5de422a8df801613d6722701163c'
      );
    }

    const fetched = await getNearcomDestination(env, 'x-user-1');
    assert.ok(fetched);
    assert.equal(fetched.nearcomAddress, 'nearcom:0xb137a2f1054b5de422a8df801613d6722701163c');
    assert.equal(fetched.intentsAccountId, '0xb137a2f1054b5de422a8df801613d6722701163c');

    const updated = await saveNearcomDestination(env, {
      xId: 'x-user-1',
      xHandle: 'uprailworld',
      rawAddress: '0x1111111111111111111111111111111111111111',
    });
    assert.equal(updated.ok, true);
    if (updated.ok) {
      assert.equal(
        updated.destination.nearcomAddress,
        'nearcom:0x1111111111111111111111111111111111111111'
      );
      assert.equal(
        updated.destination.intentsAccountId,
        '0x1111111111111111111111111111111111111111'
      );
    }
  });
});
