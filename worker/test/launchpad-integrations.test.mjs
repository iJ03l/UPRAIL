import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  buildLaunchpadRegistrationMessage,
  canonicalJson,
  parentAccountOf,
  proofIssuedAtValid,
  verifyLaunchpadProofSignature,
} from '../dist/launchpadAuth.bundle.mjs';
import {
  deniedLaunchpadTarget,
  launchStepReady,
  parseLaunchpadClaimConfig,
  parseLaunchpadVerificationConfig,
  registerLaunchpadToken,
  registrationSignerAllowed,
  tokenSymbolImpersonatesUprail,
} from '../dist/launchpadIntegrations.bundle.mjs';
import {
  creatorFeeCardKey,
  creatorFeeCardKeyValid,
  getCreatorFeeCardSummary,
  normalizeCreatorFeeAsset,
  normalizeCreatorFeeHandle,
} from '../dist/creatorFeesCard.bundle.mjs';
import {
  isAccessKeyPermission,
  nep413Serialize,
  parseNearFtEvents,
  collectFtTransfers,
} from '../dist/nearRpc.bundle.mjs';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(source) {
  let zeroes = 0;
  while (zeroes < source.length && source[zeroes] === 0) zeroes++;
  const digits = [];
  for (let i = zeroes; i < source.length; i++) {
    let carry = source[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '1'.repeat(zeroes);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

async function makeProof(message, recipient = 'uprail.near') {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const digest = await crypto.subtle.digest(
    'SHA-256',
    nep413Serialize(message, nonce, recipient)
  );
  const signature = ed25519.sign(new Uint8Array(digest), privateKey);
  return {
    publicKey: `ed25519:${base58Encode(publicKey)}`,
    signature: Buffer.from(signature).toString('base64'),
    nonce: Buffer.from(nonce).toString('base64'),
    recipient,
  };
}

describe('launchpad proof verification', () => {
  it('canonicalizes JSON independent of key order', () => {
    assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
    assert.equal(canonicalJson([{ b: 2, a: 1 }]), '[{"a":1,"b":2}]');
  });

  it('derives the launchpad parent account from the token', () => {
    assert.equal(parentAccountOf('3am-8894b9.launchpad.justhoot.near'), 'launchpad.justhoot.near');
    assert.equal(parentAccountOf('uptober.nearlytrade.near'), 'nearlytrade.near');
    assert.equal(parentAccountOf('token.near'), null);
  });

  it('accepts a valid NEP-413 proof and rejects tampering', async () => {
    const message = await buildLaunchpadRegistrationMessage({
      token: 'alice.launchpad.near',
      handle: 'alice',
      launchpad: { id: 'custom', name: 'Custom' },
      verification: { kind: 'token_config', method: 'get_config', paths: [['fee_to']] },
      claim: null,
      issuedAt: 1_800_000_000_000,
    });
    const proof = await makeProof(message);
    assert.equal(await verifyLaunchpadProofSignature(proof, message, 'uprail.near'), true);
    assert.equal(await verifyLaunchpadProofSignature(proof, `${message} `, 'uprail.near'), false);
    assert.equal(await verifyLaunchpadProofSignature(proof, message, 'other.near'), false);
  });

  it('accepts full-access and function-call keys as launchpad authority', () => {
    assert.equal(isAccessKeyPermission('FullAccess'), true);
    assert.equal(
      isAccessKeyPermission({ FunctionCall: { receiver_id: 'launchpad.near', method_names: [] } }),
      true
    );
    assert.equal(isAccessKeyPermission(undefined), false);
    assert.equal(isAccessKeyPermission({}), false);
  });

  it('bounds proof timestamps to five minutes', () => {
    const now = 1_800_000_000_000;
    assert.equal(proofIssuedAtValid(now, now), true);
    assert.equal(proofIssuedAtValid(now - 301_000, now), false);
    assert.equal(proofIssuedAtValid('now', now), false);
  });
});

describe('launchpad configuration parsing', () => {
  it('parses token_config verification with fee paths', () => {
    const parsed = parseLaunchpadVerificationConfig({
      kind: 'token_config',
      method: 'get_config',
      paths: [['creator_id'], ['owner_id']],
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.config.kind, 'token_config');
    assert.deepEqual(parsed.config.paths, [['creator_id'], ['owner_id']]);
  });

  it('parses factory verification with defaults', () => {
    const parsed = parseLaunchpadVerificationConfig({
      kind: 'factory',
      contract: 'nearlytrade.near',
      method: 'get_launch_by_token',
      launchIdPath: ['id'],
      feeMethod: 'get_fee_to',
      feePath: [],
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.config.tokenArg, 'token');
    assert.equal(parsed.config.feeArg, 'launch_id');
  });

  it('parses the JustHoot v2 dev check and rejects other factories', () => {
    const parsed = parseLaunchpadVerificationConfig({
      kind: 'jh_v2_dev',
      launchpad: 'v2-launchpad.justhoot.near',
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.config.launchpad, 'v2-launchpad.justhoot.near');
    assert.equal(
      parseLaunchpadVerificationConfig({ kind: 'jh_v2_dev', launchpad: 'launchpad.justhoot.near' }).ok,
      false
    );
  });

  it('lets a Nearly creator sign and only the JustHoot dev sign', () => {
    assert.equal(
      registrationSignerAllowed({
        kind: 'factory',
        signerId: 'creator.near',
        parent: 'nearlytrade.near',
        creator: 'creator.near',
      }),
      true
    );
    assert.equal(
      registrationSignerAllowed({
        kind: 'factory',
        signerId: 'someone.near',
        parent: 'nearlytrade.near',
        creator: 'creator.near',
      }),
      false
    );
    assert.equal(
      registrationSignerAllowed({
        kind: 'jh_v2_dev',
        signerId: 'dev.near',
        parent: 'v2-launchpad.justhoot.near',
        devId: 'dev.near',
      }),
      true
    );
    assert.equal(
      registrationSignerAllowed({
        kind: 'jh_v2_dev',
        signerId: 'v2-launchpad.justhoot.near',
        parent: 'v2-launchpad.justhoot.near',
        devId: 'dev.near',
      }),
      false
    );
  });

  it('rejects impersonation targets and unfinished launches', () => {
    assert.equal(deniedLaunchpadTarget('up.v2-launchpad.justhoot.near'), 'up.v2-launchpad.justhoot.near');
    assert.equal(deniedLaunchpadTarget('za.v2-launchpad.justhoot.near', 'uprailworld.near'), 'uprailworld.near');
    assert.equal(deniedLaunchpadTarget('za.v2-launchpad.justhoot.near', 'free-name.herewallet.near'), null);
    assert.equal(tokenSymbolImpersonatesUprail('UPRAIL'), true);
    assert.equal(tokenSymbolImpersonatesUprail('ZA'), false);
    assert.equal(launchStepReady({ step: 'Done', creator: 'a.near' }), true);
    assert.equal(launchStepReady({ step: 'Pool', creator: 'a.near' }), false);
    assert.equal(launchStepReady({ creator: 'a.near' }), true);
  });

  it('rejects a denylisted token before proof checks', async () => {
    const denied = await registerLaunchpadToken(
      {},
      {
        token: 'up.v2-launchpad.justhoot.near',
        handle: 'alice',
        launchpad: { id: 'justhoot' },
      }
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'DENIED');
  });

  it('rejects malformed verification and claim configs', () => {
    assert.equal(parseLaunchpadVerificationConfig({ kind: 'nope' }).ok, false);
    assert.equal(
      parseLaunchpadVerificationConfig({ kind: 'token_config', method: 'bad method', paths: [[]] }).ok,
      false
    );
    assert.equal(parseLaunchpadClaimConfig({ kind: 'token_claim' }).ok, false);
  });

  it('parses generic claim configs', () => {
    const parsed = parseLaunchpadClaimConfig({
      kind: 'token_claim',
      owedMethod: 'get_owed_fees',
      owedTokenPath: ['token'],
      owedQuotePath: ['quote'],
      claimMethod: 'claim_owed_fees',
      quoteContract: 'wrap.near',
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.config.accountArg, 'account_id');
    assert.deepEqual(parsed.config.claimArgs, {});
  });
});

describe('launchpad registration validation', () => {
  it('rejects invalid contract ids, handles, and launchpad ids before proof checks', async () => {
    const badToken = await registerLaunchpadToken({}, { token: 'not a token', handle: 'alice' });
    assert.equal(badToken.ok, false);
    assert.equal(badToken.code, 'INVALID_TOKEN');

    const badHandle = await registerLaunchpadToken(
      {},
      {
        token: 'alice.launchpad.near',
        handle: 'not a handle',
        launchpad: { id: 'custom' },
      }
    );
    assert.equal(badHandle.ok, false);
    assert.equal(badHandle.code, 'INVALID_HANDLE');

    const badLaunchpad = await registerLaunchpadToken(
      {},
      {
        token: 'alice.launchpad.near',
        handle: 'alice',
        launchpad: { id: 'bad id!' },
      }
    );
    assert.equal(badLaunchpad.ok, false);
    assert.equal(badLaunchpad.code, 'INVALID_LAUNCHPAD');
  });
});

describe('launchpad claim amount parsing', () => {
  it('reads exact claimed amounts from NEP-141 events', () => {
    const event = (oldOwner, newOwner, amount) =>
      `EVENT_JSON:${JSON.stringify({
        standard: 'nep141',
        version: '1.0.0',
        event: 'ft_transfer',
        data: [{ old_owner_id: oldOwner, new_owner_id: newOwner, amount }],
      })}`;
    const events = parseNearFtEvents({
      receipts_outcome: [
        {
          id: 'token-receipt',
          outcome: {
            executor_id: 'alice.launchpad.near',
            logs: [event('alice.launchpad.near', 'escrow.uprail.near', '2500')],
          },
        },
        {
          id: 'quote-receipt',
          outcome: {
            executor_id: 'wrap.near',
            logs: [
              event('alice.launchpad.near', 'escrow.uprail.near', '175'),
              'not an event',
            ],
          },
        },
      ],
    });
    assert.deepEqual(events, [
      {
        contract: 'alice.launchpad.near',
        from: 'alice.launchpad.near',
        to: 'escrow.uprail.near',
        amountAtomic: '2500',
      },
      {
        contract: 'wrap.near',
        from: 'alice.launchpad.near',
        to: 'escrow.uprail.near',
        amountAtomic: '175',
      },
    ]);
  });

  it('reads an adapter payout from an inner ft_transfer and from wrap.near logs', () => {
    const fromReceipt = collectFtTransfers({
      receipts: [
        {
          receipt_id: 'r1',
          receiver_id: 'wrap.near',
          receipt: {
            Action: {
              actions: [
                {
                  FunctionCall: {
                    method_name: 'ft_transfer',
                    args: Buffer.from(
                      JSON.stringify({
                        receiver_id: 'escrow.uprail.near',
                        amount: '1000',
                        memo: 'Fees to @alice via UPRAIL',
                      })
                    ).toString('base64'),
                  },
                },
              ],
            },
          },
        },
      ],
      receipts_outcome: [
        {
          id: 'r1',
          outcome: {
            executor_id: 'wrap.near',
            logs: ['Transfer 1000 from launchpad.near to escrow.uprail.near', 'Memo: Fees to @alice via UPRAIL'],
          },
        },
      ],
    });
    assert.equal(fromReceipt.length, 1);
    assert.equal(fromReceipt[0].memo, 'Fees to @alice via UPRAIL');
    assert.equal(fromReceipt[0].amountAtomic, '1000');

    const fromLogs = collectFtTransfers({
      receipts_outcome: [
        {
          id: 'r2',
          outcome: {
            executor_id: 'wrap.near',
            logs: [
              'Transfer 15822714681440443099528 from v2-launchpad.justhoot.near to escrow.uprail.near',
              'Memo: Fees to @bob via UPRAIL',
            ],
          },
        },
      ],
    });
    assert.equal(fromLogs[0].to, 'escrow.uprail.near');
    assert.equal(fromLogs[0].memo, 'Fees to @bob via UPRAIL');
    assert.equal(
      collectFtTransfers({
        receipts_outcome: [
          {
            id: 'r3',
            outcome: {
              executor_id: 'wrap.near',
              logs: ['Memo: {"purpose":"fee_split","role":"token_owner"}'],
            },
          },
        ],
      }).length,
      0
    );
  });
});

describe('creator fee preview cards', () => {
  it('normalizes and validates handles', () => {
    assert.equal(normalizeCreatorFeeHandle('@Alice'), 'alice');
    assert.equal(normalizeCreatorFeeHandle('bad-handle'), '');
    assert.equal(normalizeCreatorFeeHandle(''), '');
    assert.equal(normalizeCreatorFeeAsset('NEP141:Alice.Token'), 'nep141:alice.token');
    assert.equal(normalizeCreatorFeeAsset('bad asset'), '');
  });

  it('signs card keys only for the matching handle', async () => {
    const env = { SESSION_SECRET: 'test-secret' };
    const key = await creatorFeeCardKey(env, 'alice', 'nep141:alice.token');
    assert.ok(key);
    assert.equal(await creatorFeeCardKeyValid(env, 'alice', 'nep141:alice.token', key), true);
    assert.equal(await creatorFeeCardKeyValid(env, 'bob', 'nep141:alice.token', key), false);
    assert.equal(await creatorFeeCardKeyValid(env, 'alice', 'nep141:bob.token', key), false);
    assert.equal(await creatorFeeCardKeyValid({}, 'alice', 'nep141:alice.token', key), false);
  });

  it('summarizes total and pending creator fees per handle', async () => {
    const rows = [
      { asset: 'near', amount: '450', status: 'ESCROWED', created_at: 2 },
      { asset: 'near', amount: '500', status: 'CLAIMED', created_at: 1 },
    ];
    const env = {
      SESSION_SECRET: 'test-secret',
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({ results: rows }),
          }),
        }),
      },
    };
    const summary = await getCreatorFeeCardSummary(env, '@Alice', 'near');
    assert.equal(summary.handle, 'alice');
    assert.equal(summary.asset, 'near');
    assert.equal(summary.count, 2);
    assert.equal(summary.pendingCount, 1);
    assert.equal(summary.headline, '950.00 NEAR');
    assert.equal(summary.subline, '@alice · 2 creator fees · 1 pending');
    assert.match(summary.detail, /450\.00 NEAR ready to claim/);
  });

  it('shows settled direct fees with no pending amount', async () => {
    const rows = [
      { asset: 'near', amount: '450', status: 'CLAIMED', created_at: 2 },
      { asset: 'near', amount: '500', status: 'CLAIMED', created_at: 1 },
    ];
    const env = {
      SESSION_SECRET: 'test-secret',
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({ results: rows }),
          }),
        }),
      },
    };
    const summary = await getCreatorFeeCardSummary(env, 'alice', 'near');
    assert.equal(summary.count, 2);
    assert.equal(summary.pendingCount, 0);
    assert.equal(summary.headline, '950.00 NEAR');
    assert.equal(summary.subline, '@alice · 2 creator fees settled');
    assert.equal(summary.detail, 'No pending fees. Settled to your UPRAIL balance.');
  });
});
