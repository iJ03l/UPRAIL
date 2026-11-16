use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signer as _, SigningKey as EdSigningKey};
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};
use p256::ecdsa::{signature::hazmat::PrehashSigner, SigningKey as P256SigningKey};
use sha2::{Digest as _, Sha256};

const ORIGIN: &str = "https://app.uprail.world";

// P-256 curve order n (big-endian bytes)
const P256_N_BE: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17, 0x9e, 0x84, 0xf3, 0xb9, 0xca, 0xc2, 0xfc, 0x63, 0x25, 0x51,
];

fn sub_be_32(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut borrow: i16 = 0;
    for i in (0..32).rev() {
        let diff = (a[i] as i16) - (b[i] as i16) - borrow;
        if diff < 0 {
            out[i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            out[i] = diff as u8;
            borrow = 0;
        }
    }
    out
}

struct PasskeyActor {
    account_id: AccountId,
    signing_key: P256SigningKey,
    pubkey_near: String,
}

impl PasskeyActor {
    fn new(name: &str, seed_byte: u8) -> Self {
        let mut seed = [seed_byte; 32];
        seed[0] = seed_byte.wrapping_add(11);
        let signing_key = P256SigningKey::from_slice(&seed).unwrap();
        let point = signing_key.verifying_key().to_encoded_point(false);
        let xy = &point.as_bytes()[1..65];
        let pubkey_near = format!("p256:{}", bs58::encode(xy).into_string());
        Self {
            account_id: name.parse().unwrap(),
            signing_key,
            pubkey_near,
        }
    }

    fn sign_webauthn(&self, payload: &[u8], force_high_s: bool) -> AuthProof {
        let challenge = Sha256::digest(payload);
        let client_data_json = format!(
            r#"{{"type":"webauthn.get","challenge":"{}","origin":"{}","crossOrigin":false}}"#,
            URL_SAFE_NO_PAD.encode(challenge),
            ORIGIN
        );
        let mut auth_data = vec![0x42u8; 37];
        auth_data[32] = 0x05; // UP + UV set
        let client_hash = Sha256::digest(client_data_json.as_bytes());
        let mut signed_msg = Vec::with_capacity(auth_data.len() + 32);
        signed_msg.extend_from_slice(&auth_data);
        signed_msg.extend_from_slice(&client_hash);
        let digest = Sha256::digest(&signed_msg);

        let sig: p256::ecdsa::Signature = self.signing_key.sign_prehash(&digest).unwrap();
        let normalized = sig.normalize_s().unwrap_or(sig);
        let mut raw: [u8; 64] = normalized.to_bytes().into();
        if force_high_s {
            let s: [u8; 32] = raw[32..64].try_into().unwrap();
            let high_s = sub_be_32(&P256_N_BE, &s);
            raw[32..64].copy_from_slice(&high_s);
        }

        AuthProof::WebAuthn(WebAuthnProof {
            pubkey: self.pubkey_near.clone(),
            authenticator_data: URL_SAFE_NO_PAD.encode(&auth_data),
            client_data_json,
            signature: format!("p256:{}", bs58::encode(raw).into_string()),
        })
    }
}

fn make_ed_actor(seed_byte: u8) -> (EdSigningKey, String) {
    let sk = EdSigningKey::from_bytes(&[seed_byte; 32]);
    let pk_str = format!("ed25519:{}", bs58::encode(sk.verifying_key().to_bytes()).into_string());
    (sk, pk_str)
}

fn sign_ed(sk: &EdSigningKey, msg: &[u8]) -> String {
    let sig = sk.sign(msg);
    format!("ed25519:{}", bs58::encode(sig.to_bytes()).into_string())
}

fn sha256_hex(input: &str) -> String {
    hex::encode(Sha256::digest(input.as_bytes()))
}

fn contract_account() -> AccountId {
    "circle.uprail.near".parse().unwrap()
}

fn setup_contract(time_ms: u64) -> (CircleEscrowContract, EdSigningKey, AccountId) {
    let (attestor_sk, attestor_pk) = make_ed_actor(99);
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(contract_account())
        .predecessor_account_id(contract_account())
        .block_timestamp(time_ms * 1_000_000);
    testing_env!(builder.build());

    let contract = CircleEscrowContract::new(
        "intents.near".parse().unwrap(),
        "escrow.uprail.near".parse().unwrap(),
        attestor_pk,
        Some(vec![ORIGIN.to_string()]),
    );
    (contract, attestor_sk, contract_account())
}

fn set_context(predecessor: AccountId, time_ms: u64) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(contract_account())
        .predecessor_account_id(predecessor)
        .block_timestamp(time_ms * 1_000_000);
    testing_env!(builder.build());
}

fn set_callback_context(succeeded: bool, time_ms: u64) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(contract_account())
        .predecessor_account_id(contract_account())
        .block_timestamp(time_ms * 1_000_000);
    let result = if succeeded {
        PromiseResult::Successful(vec![])
    } else {
        PromiseResult::Failed
    };
    testing_env!(builder.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

#[test]
fn circle_create_sign_contribute_settle_happy_path_and_1pct_fee() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, _, cid_acct) = setup_contract(t0);
    let alice = PasskeyActor::new("alice.uprail.near", 1);
    let bob = PasskeyActor::new("bob.uprail.near", 2);
    let payout: AccountId = "payout.uprail.near".parse().unwrap();
    let asset = AssetSpec::Intents {
        token_id: "nep141:gtusdcp.near".to_string(),
    };
    let members = vec![
        CircleMemberInput {
            account_id: alice.account_id.clone(),
            pubkey: alice.pubkey_near.clone(),
            share_bps: 6000,
        },
        CircleMemberInput {
            account_id: bob.account_id.clone(),
            pubkey: bob.pubkey_near.clone(),
            share_bps: 4000,
        },
    ];
    let circle_id = "trip_2026".to_string();
    let agree_payload = canonical_circle_agree_payload(
        &cid_acct,
        &circle_id,
        &alice.account_id,
        &payout,
        &asset,
        1_000_000,
        &members,
    );

    // High-S signature must be rejected on create!
    let res_high_s = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut c2 = CircleEscrowContract::new(
            "intents.near".parse().unwrap(),
            "escrow.uprail.near".parse().unwrap(),
            make_ed_actor(99).1,
            Some(vec![ORIGIN.to_string()]),
        );
        c2.create_circle(
            circle_id.clone(),
            asset.clone(),
            members.clone(),
            0,
            payout.clone(),
            sha256_hex("payout"),
            U128(1_000_000),
            Some(alice.sign_webauthn(&agree_payload, true)),
        );
    }));
    assert!(res_high_s.is_err(), "High-S WebAuthn signature must fail");

    let view = contract.create_circle(
        circle_id.clone(),
        asset.clone(),
        members.clone(),
        0,
        payout.clone(),
        sha256_hex("payout"),
        U128(1_000_000),
        Some(alice.sign_webauthn(&agree_payload, false)),
    );
    assert_eq!(view.status, CircleStatus::PendingSignatures);

    // Contribution before all members sign must be refunded cleanly (returns full amounts)
    set_context("intents.near".parse().unwrap(), t0 + 100);
    let refund = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![alice.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(600_000)],
        serde_json_msg_circle(&circle_id),
    );
    match refund {
        PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(600_000)]),
        _ => panic!("expected refund vector"),
    }

    // Bob signs -> transitions PENDING_SIGNATURES -> ACTIVE
    set_context(bob.account_id.clone(), t0 + 200);
    let view = contract.sign_circle_terms(
        circle_id.clone(),
        1,
        bob.sign_webauthn(&agree_payload, false),
    );
    assert_eq!(view.status, CircleStatus::Active);

    // Non-member deposit is refunded cleanly
    set_context("intents.near".parse().unwrap(), t0 + 300);
    let stranger: AccountId = "stranger.near".parse().unwrap();
    let r_stranger = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![stranger],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(100_000)],
        serde_json_msg_circle(&circle_id),
    );
    match r_stranger {
        PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(100_000)]),
        _ => panic!("expected refund"),
    }

    // Wrong asset is refunded cleanly
    let r_wrong_asset = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![alice.account_id.clone()],
        vec!["nep141:other.near".to_string()],
        vec![U128(100_000)],
        serde_json_msg_circle(&circle_id),
    );
    match r_wrong_asset {
        PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(100_000)]),
        _ => panic!("expected refund"),
    }

    // Alice + Bob contribute
    let r_a = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![alice.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(600_000)],
        serde_json_msg_circle(&circle_id),
    );
    match r_a {
        PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(0)]),
        _ => panic!("expected 0 refund"),
    }
    let r_b = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![bob.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(400_000)],
        serde_json_msg_circle(&circle_id),
    );
    match r_b {
        PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(0)]),
        _ => panic!("expected 0 refund"),
    }
    assert_eq!(contract.get_circle(circle_id.clone()).unwrap().total_contributed.0, 1_000_000);

    // Non-creator signature on settle fails
    let settle_payload = canonical_circle_settle_payload(&cid_acct, &circle_id, &payout, 1_000_000);
    set_context(bob.account_id.clone(), t0 + 400);
    let non_creator_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut c2 = CircleEscrowContract::new(
            "intents.near".parse().unwrap(),
            "escrow.uprail.near".parse().unwrap(),
            make_ed_actor(99).1,
            Some(vec![ORIGIN.to_string()]),
        );
        let _ = c2.create_circle(
            circle_id.clone(),
            asset.clone(),
            members.clone(),
            0,
            payout.clone(),
            sha256_hex("payout"),
            U128(1_000_000),
            Some(alice.sign_webauthn(&agree_payload, false)),
        );
        let _ = c2.sign_circle_terms(circle_id.clone(), 1, bob.sign_webauthn(&agree_payload, false));
        set_context("intents.near".parse().unwrap(), t0 + 401);
        c2.mt_on_transfer(
            "intents.near".parse().unwrap(),
            vec![alice.account_id.clone()],
            vec!["nep141:gtusdcp.near".to_string()],
            vec![U128(1_000_000)],
            serde_json_msg_circle(&circle_id),
        );
        set_context(bob.account_id.clone(), t0 + 402);
        let _ = c2.settle_circle(circle_id.clone(), bob.sign_webauthn(&settle_payload, false));
    }));
    assert!(non_creator_res.is_err(), "Non-creator cannot settle");

    // Creator settles: 99% payout = 990_000, 1% fee = 10_000
    set_context(alice.account_id.clone(), t0 + 500);
    let _ = contract.settle_circle(circle_id.clone(), alice.sign_webauthn(&settle_payload, false));
    let c_settling = contract.get_circle(circle_id.clone()).unwrap();
    assert_eq!(c_settling.status, CircleStatus::Settling);

    // Late deposit while SETTLING must be refunded cleanly!
    set_context("intents.near".parse().unwrap(), t0 + 510);
    let late_refund = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![bob.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(50_000)],
        serde_json_msg_circle(&circle_id),
    );
    match late_refund {
        PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(50_000)]),
        _ => panic!("expected refund"),
    }

    // Callback 1: payout succeeds, fee initiated; Callback 2: fee fails -> partial recovery retry works without double-paying payout!
    set_callback_context(true, t0 + 520);
    let _ = contract.on_circle_settle_payout(circle_id.clone());
    assert!(contract.get_circle(circle_id.clone()).unwrap().payout_paid);
    assert!(!contract.get_circle(circle_id.clone()).unwrap().fee_paid);

    set_callback_context(false, t0 + 530);
    contract.on_circle_settle_fee(circle_id.clone());
    assert_eq!(contract.get_circle(circle_id.clone()).unwrap().status, CircleStatus::Settling);
    assert!(contract.get_circle(circle_id.clone()).unwrap().payout_paid);
    assert!(!contract.get_circle(circle_id.clone()).unwrap().fee_paid);

    set_context(accounts(0), t0 + 540);
    let _ = contract.retry_circle_settlement(circle_id.clone());
    set_callback_context(true, t0 + 550);
    contract.on_circle_settle_fee(circle_id.clone());

    let c_done = contract.get_circle(circle_id).unwrap();
    assert_eq!(c_done.status, CircleStatus::Settled);
    assert_eq!(c_done.total_contributed.0, 0);
    assert!(c_done.payout_paid && c_done.fee_paid);
}

#[test]
fn circle_dissolve_requires_all_sigs_until_7_day_safeguard() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, _, cid_acct) = setup_contract(t0);
    let alice = PasskeyActor::new("alice.uprail.near", 10);
    let bob = PasskeyActor::new("bob.uprail.near", 20);
    let payout: AccountId = "payout.uprail.near".parse().unwrap();
    let asset = AssetSpec::Nep141 {
        contract_id: "usdc.token.near".parse().unwrap(),
    };
    let members = vec![
        CircleMemberInput {
            account_id: alice.account_id.clone(),
            pubkey: alice.pubkey_near.clone(),
            share_bps: 5000,
        },
        CircleMemberInput {
            account_id: bob.account_id.clone(),
            pubkey: bob.pubkey_near.clone(),
            share_bps: 5000,
        },
    ];
    let circle_id = "rent_may".to_string();
    let agree_payload = canonical_circle_agree_payload(
        &cid_acct,
        &circle_id,
        &alice.account_id,
        &payout,
        &asset,
        500_000,
        &members,
    );

    contract.create_circle(
        circle_id.clone(),
        asset.clone(),
        members,
        0,
        payout,
        sha256_hex("payout"),
        U128(500_000),
        Some(alice.sign_webauthn(&agree_payload, false)),
    );
    contract.sign_circle_terms(circle_id.clone(), 1, bob.sign_webauthn(&agree_payload, false));

    // Deposit via NEP-141 ft_on_transfer
    set_context("usdc.token.near".parse().unwrap(), t0 + 50);
    assert!(matches!(
        contract.ft_on_transfer(alice.account_id.clone(), U128(200_000), serde_json_msg_circle(&circle_id)),
        PromiseOrValue::Value(U128(0))
    ));
    assert!(matches!(
        contract.ft_on_transfer(bob.account_id.clone(), U128(300_000), serde_json_msg_circle(&circle_id)),
        PromiseOrValue::Value(U128(0))
    ));

    // Initiate dissolve signed by Alice only
    let dissolve_payload = canonical_circle_dissolve_payload(&cid_acct, &circle_id);
    set_context(alice.account_id.clone(), t0 + 1_000);
    let view = contract.initiate_dissolve(
        circle_id.clone(),
        0,
        alice.sign_webauthn(&dissolve_payload, false),
    );
    assert_eq!(view.status, CircleStatus::Dissolving);

    // Finalize at +6 days (missing Bob) -> MUST panic!
    set_context(alice.account_id.clone(), t0 + 1_000 + SEVEN_DAYS_MS - 1);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut c2 = CircleEscrowContract::new(
            "intents.near".parse().unwrap(),
            "escrow.uprail.near".parse().unwrap(),
            make_ed_actor(99).1,
            Some(vec![ORIGIN.to_string()]),
        );
        let a_in = CircleMemberInput {
            account_id: alice.account_id.clone(),
            pubkey: alice.pubkey_near.clone(),
            share_bps: 5000,
        };
        let b_in = CircleMemberInput {
            account_id: bob.account_id.clone(),
            pubkey: bob.pubkey_near.clone(),
            share_bps: 5000,
        };
        c2.create_circle(
            circle_id.clone(),
            asset.clone(),
            vec![a_in, b_in],
            0,
            "payout.uprail.near".parse().unwrap(),
            sha256_hex("payout"),
            U128(500_000),
            Some(alice.sign_webauthn(&agree_payload, false)),
        );
        c2.sign_circle_terms(circle_id.clone(), 1, bob.sign_webauthn(&agree_payload, false));
        set_context("usdc.token.near".parse().unwrap(), t0 + 50);
        c2.ft_on_transfer(alice.account_id.clone(), U128(200_000), serde_json_msg_circle(&circle_id));
        c2.ft_on_transfer(bob.account_id.clone(), U128(300_000), serde_json_msg_circle(&circle_id));
        set_context(alice.account_id.clone(), t0 + 1_000);
        c2.initiate_dissolve(circle_id.clone(), 0, alice.sign_webauthn(&dissolve_payload, false));
        set_context(alice.account_id.clone(), t0 + 1_000 + SEVEN_DAYS_MS - 1);
        c2.finalize_dissolve(circle_id.clone(), None);
    }));
    assert!(early.is_err(), "Cannot bypass missing member sig before 7 days");

    // At +7 days exact -> safeguard unlocks finalize_dissolve pro-rata 0% fee!
    set_context(alice.account_id.clone(), t0 + 1_000 + SEVEN_DAYS_MS);
    let _ = contract.finalize_dissolve(circle_id.clone(), None);
    set_callback_context(true, t0 + 1_000 + SEVEN_DAYS_MS + 10);
    contract.on_circle_member_refund(circle_id.clone(), 0, U128(200_000));
    set_callback_context(true, t0 + 1_000 + SEVEN_DAYS_MS + 20);
    contract.on_circle_member_refund(circle_id.clone(), 1, U128(300_000));

    let done = contract.get_circle(circle_id).unwrap();
    assert_eq!(done.status, CircleStatus::Dissolved);
    assert_eq!(done.members[0].refunded_amount.0, 200_000);
    assert_eq!(done.members[1].refunded_amount.0, 300_000);
    assert_eq!(done.total_contributed.0, 0);
}

#[test]
fn gift_timelock_claim_and_reclaim() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, attestor_sk, cid_acct) = setup_contract(t0);
    let sender = PasskeyActor::new("sender.uprail.near", 31);
    let recip = PasskeyActor::new("recip.uprail.near", 32);
    let unlock_at = t0 + 86_400_000;
    let reclaim_at = t0 + 7 * 86_400_000;
    let handle_hash = sha256_hex("bob");

    let msg = format!(
        r#"{{"action":"create_and_fund_gift","gift_id":"gift_1","sender_pubkey":"{}","recipient_handle_hash":"{}","recipient_pubkey":"{}","unlock_at_ms":{},"reclaim_after_ms":{}}}"#,
        sender.pubkey_near, handle_hash, recip.pubkey_near, unlock_at, reclaim_at
    );

    set_context("intents.near".parse().unwrap(), t0);
    let dep = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![sender.account_id.clone()],
        vec!["nep141:tlo.near".to_string()],
        vec![U128(990_000)],
        msg,
    );
    assert!(matches!(dep, PromiseOrValue::Value(v) if v == vec![U128(0)]));

    // Claim before unlock_at fails
    let claim_deadline = unlock_at + 60_000;
    let attest_payload =
        canonical_gift_claim_payload(&cid_acct, "gift_1", &handle_hash, &recip.account_id, claim_deadline);
    let attest_sig = sign_ed(&attestor_sk, &attest_payload);
    let recip_payload = canonical_gift_recipient_payload(&cid_acct, "gift_1", &recip.account_id);
    let recip_proof = recip.sign_webauthn(&recip_payload, false);

    set_context(recip.account_id.clone(), unlock_at - 1);
    let too_early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut c2 = CircleEscrowContract::new(
            "intents.near".parse().unwrap(),
            "escrow.uprail.near".parse().unwrap(),
            make_ed_actor(99).1,
            Some(vec![ORIGIN.to_string()]),
        );
        let msg2 = format!(
            r#"{{"action":"create_and_fund_gift","gift_id":"gift_1","sender_pubkey":"{}","recipient_handle_hash":"{}","recipient_pubkey":"{}","unlock_at_ms":{},"reclaim_after_ms":{}}}"#,
            sender.pubkey_near, handle_hash, recip.pubkey_near, unlock_at, reclaim_at
        );
        set_context("intents.near".parse().unwrap(), t0);
        c2.mt_on_transfer("intents.near".parse().unwrap(), vec![sender.account_id.clone()], vec!["nep141:tlo.near".to_string()], vec![U128(990_000)], msg2);
        set_context(recip.account_id.clone(), unlock_at - 1);
        let _ = c2.claim_gift("gift_1".into(), recip.account_id.clone(), claim_deadline, attest_sig.clone(), Some(recip_proof.clone()));
    }));
    assert!(too_early.is_err(), "Cannot claim gift before unlock_at");

    // Claim at unlock_at succeeds
    set_context(recip.account_id.clone(), unlock_at);
    let _ = contract.claim_gift(
        "gift_1".into(),
        recip.account_id.clone(),
        claim_deadline,
        attest_sig,
        Some(recip_proof),
    );
    set_callback_context(true, unlock_at + 10);
    contract.on_gift_payout("gift_1".into(), GiftStatus::Claimed);

    let g = contract.get_gift("gift_1".into()).unwrap();
    assert_eq!(g.status, GiftStatus::Claimed);
    assert_eq!(g.amount.0, 0);
}

#[test]
fn gift_sender_reclaim_and_unclaimed_send() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, attestor_sk, cid_acct) = setup_contract(t0);
    let sender = PasskeyActor::new("sender.uprail.near", 41);
    let recip_acct: AccountId = "u_recip.escrow.uprail.near".parse().unwrap();
    let handle_hash = sha256_hex("carol");

    let unlock_at = t0 + 1_000;
    let reclaim_at = t0 + 10_000;
    let gift_msg = format!(
        r#"{{"action":"create_and_fund_gift","gift_id":"gift_reclaim","sender_pubkey":"{}","recipient_handle_hash":"{}","recipient_pubkey":null,"unlock_at_ms":{},"reclaim_after_ms":{}}}"#,
        sender.pubkey_near, handle_hash, unlock_at, reclaim_at
    );
    set_context("intents.near".parse().unwrap(), t0);
    contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![sender.account_id.clone()],
        vec!["nep141:tlo.near".to_string()],
        vec![U128(500_000)],
        gift_msg,
    );

    let reclaim_payload = canonical_gift_reclaim_payload(&cid_acct, "gift_reclaim", &sender.account_id);
    set_context(sender.account_id.clone(), reclaim_at + 1);
    let _ = contract.reclaim_gift(
        "gift_reclaim".into(),
        sender.sign_webauthn(&reclaim_payload, false),
    );
    set_callback_context(true, reclaim_at + 10);
    contract.on_gift_payout("gift_reclaim".into(), GiftStatus::Reclaimed);
    assert_eq!(contract.get_gift("gift_reclaim".into()).unwrap().status, GiftStatus::Reclaimed);

    // Unclaimed @handle send claim + attestor check
    let send_msg = format!(
        r#"{{"action":"create_unclaimed_send","send_id":"send_1","sender_pubkey":"{}","recipient_handle_hash":"{}","refund_after_ms":{},"allow_early_cancel":false}}"#,
        sender.pubkey_near,
        handle_hash,
        t0 + 86_400_000
    );
    set_context("intents.near".parse().unwrap(), t0);
    contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![sender.account_id.clone()],
        vec!["nep141:usdc.token.near".to_string()],
        vec![U128(1_000_000)],
        send_msg,
    );

    let attest_payload =
        canonical_unclaimed_claim_payload(&cid_acct, "send_1", &handle_hash, &recip_acct, t0 + 60_000);
    let attest_sig = sign_ed(&attestor_sk, &attest_payload);
    set_context(recip_acct.clone(), t0 + 500);
    let _ = contract.claim_unclaimed_send("send_1".into(), recip_acct, t0 + 60_000, attest_sig);
    set_callback_context(true, t0 + 600);
    contract.on_unclaimed_send_payout("send_1".into(), UnclaimedSendStatus::Claimed);

    let s = contract.get_unclaimed_send("send_1".into()).unwrap();
    assert_eq!(s.status, UnclaimedSendStatus::Claimed);
    assert_eq!(s.amount.0, 0);
}

#[test]
fn many_circles_from_different_groups_are_strictly_isolated_and_tied_to_signers() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, _, cid_acct) = setup_contract(t0);
    let alice = PasskeyActor::new("alice.uprail.near", 101);
    let bob = PasskeyActor::new("bob.uprail.near", 102);
    let carol = PasskeyActor::new("carol.uprail.near", 103);
    let dave = PasskeyActor::new("dave.uprail.near", 104);
    let eve = PasskeyActor::new("eve.uprail.near", 105);

    let groups: Vec<(&str, &PasskeyActor, &PasskeyActor, u128)> = vec![
        ("grp_alpha_1", &alice, &bob, 1_000_000),
        ("grp_beta_2", &alice, &carol, 2_000_000),
        ("grp_gamma_3", &bob, &dave, 3_000_000),
        ("grp_delta_4", &carol, &eve, 4_000_000),
        ("grp_alpha_5", &alice, &bob, 5_000_000),
    ];

    let asset = AssetSpec::Intents {
        token_id: "nep141:gtusdcp.near".to_string(),
    };

    for (cid, m0, m1, amt) in &groups {
        let members = vec![
            CircleMemberInput {
                account_id: m0.account_id.clone(),
                pubkey: m0.pubkey_near.clone(),
                share_bps: 5000,
            },
            CircleMemberInput {
                account_id: m1.account_id.clone(),
                pubkey: m1.pubkey_near.clone(),
                share_bps: 5000,
            },
        ];
        let payload = canonical_circle_agree_payload(
            &cid_acct,
            cid,
            &m0.account_id,
            &m1.account_id,
            &asset,
            *amt,
            &members,
        );
        set_context(m0.account_id.clone(), t0);
        let c = contract.create_circle(
            (*cid).into(),
            asset.clone(),
            members,
            0,
            m1.account_id.clone(),
            sha256_hex("payout"),
            U128(*amt),
            Some(m0.sign_webauthn(&payload, false)),
        );
        assert_eq!(c.status, CircleStatus::PendingSignatures);

        set_context(m1.account_id.clone(), t0 + 10);
        let c = contract.sign_circle_terms((*cid).into(), 1, m1.sign_webauthn(&payload, false));
        assert_eq!(c.status, CircleStatus::Active);

        set_context("intents.near".parse().unwrap(), t0 + 20);
        let res = contract.mt_on_transfer(
            "intents.near".parse().unwrap(),
            vec![m0.account_id.clone()],
            vec!["nep141:gtusdcp.near".to_string()],
            vec![U128(*amt / 2)],
            serde_json_msg_circle(cid),
        );
        match res {
            PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(0)]),
            _ => panic!("expected Value"),
        }
    }

    // Outsider deposit (e.g. dave depositing into alice/bob's circle) must refund 100%
    set_context("intents.near".parse().unwrap(), t0 + 30);
    let outsider_res = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![dave.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(999_999)],
        serde_json_msg_circle("grp_alpha_1"),
    );
    match outsider_res {
        PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(999_999)]),
        _ => panic!("expected full refund for non-member deposit"),
    }

    // Wrong asset deposit into a circle must refund 100%
    let wrong_asset_res = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![alice.account_id.clone()],
        vec!["nep141:stnear.near".to_string()],
        vec![U128(500_000)],
        serde_json_msg_circle("grp_alpha_1"),
    );
    match wrong_asset_res {
        PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(500_000)]),
        _ => panic!("expected full refund for wrong asset"),
    }

    // Settle grp_alpha_1 and confirm grp_alpha_5 (same members!) and grp_beta_2 stay ACTIVE with intact balances
    let settle_p = canonical_circle_settle_payload(&cid_acct, "grp_alpha_1", &bob.account_id, 500_000);
    set_context(alice.account_id.clone(), t0 + 40);
    let _ = contract.settle_circle("grp_alpha_1".into(), alice.sign_webauthn(&settle_p, false));
    set_callback_context(true, t0 + 41);
    let _ = contract.on_circle_settle_payout("grp_alpha_1".into());
    set_callback_context(true, t0 + 42);
    contract.on_circle_settle_fee("grp_alpha_1".into());

    assert_eq!(contract.get_circle("grp_alpha_1".into()).unwrap().status, CircleStatus::Settled);
    assert_eq!(contract.get_circle("grp_alpha_5".into()).unwrap().status, CircleStatus::Active);
    assert_eq!(contract.get_circle("grp_alpha_5".into()).unwrap().total_contributed.0, 2_500_000);
    assert_eq!(contract.get_circle("grp_beta_2".into()).unwrap().total_contributed.0, 1_000_000);
}

#[test]
#[should_panic(expected = "Duplicate member pubkey")]
fn security_rejects_duplicate_member_pubkey_within_circle() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, _, _) = setup_contract(t0);
    let alice = PasskeyActor::new("alice.uprail.near", 111);
    let bob = PasskeyActor::new("bob.uprail.near", 112);
    set_context(alice.account_id.clone(), t0);
    let _ = contract.create_circle(
        "dup_pk".into(),
        AssetSpec::Intents {
            token_id: "nep141:gtusdcp.near".to_string(),
        },
        vec![
            CircleMemberInput {
                account_id: alice.account_id.clone(),
                pubkey: alice.pubkey_near.clone(),
                share_bps: 5000,
            },
            CircleMemberInput {
                account_id: bob.account_id.clone(),
                pubkey: alice.pubkey_near.clone(),
                share_bps: 5000,
            },
        ],
        0,
        alice.account_id.clone(),
        sha256_hex("alice"),
        U128(100),
        None,
    );
}

#[test]
#[should_panic(expected = "Invalid creator signature")]
fn security_rejects_cross_circle_replay_signature() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, _, cid_acct) = setup_contract(t0);
    let alice = PasskeyActor::new("alice.uprail.near", 121);
    let bob = PasskeyActor::new("bob.uprail.near", 122);
    let asset = AssetSpec::Intents {
        token_id: "nep141:gtusdcp.near".to_string(),
    };
    let members = vec![
        CircleMemberInput {
            account_id: alice.account_id.clone(),
            pubkey: alice.pubkey_near.clone(),
            share_bps: 5000,
        },
        CircleMemberInput {
            account_id: bob.account_id.clone(),
            pubkey: bob.pubkey_near.clone(),
            share_bps: 5000,
        },
    ];
    let payload_a = canonical_circle_agree_payload(
        &cid_acct,
        "circle_a",
        &alice.account_id,
        &bob.account_id,
        &asset,
        1_000,
        &members,
    );
    let sig_for_a = alice.sign_webauthn(&payload_a, false);
    set_context(alice.account_id.clone(), t0);
    let _ = contract.create_circle(
        "circle_b".into(),
        asset,
        members,
        0,
        bob.account_id.clone(),
        sha256_hex("bob"),
        U128(1_000),
        Some(sig_for_a),
    );
}

#[test]
#[should_panic(expected = "Invalid creator settlement signature")]
fn security_rejects_non_creator_settling_circle() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, _, cid_acct) = setup_contract(t0);
    let alice = PasskeyActor::new("alice.uprail.near", 131);
    let bob = PasskeyActor::new("bob.uprail.near", 132);
    let asset = AssetSpec::Intents {
        token_id: "nep141:gtusdcp.near".to_string(),
    };
    let members = vec![
        CircleMemberInput {
            account_id: alice.account_id.clone(),
            pubkey: alice.pubkey_near.clone(),
            share_bps: 5000,
        },
        CircleMemberInput {
            account_id: bob.account_id.clone(),
            pubkey: bob.pubkey_near.clone(),
            share_bps: 5000,
        },
    ];
    let agree_p = canonical_circle_agree_payload(
        &cid_acct,
        "non_creator_settle",
        &alice.account_id,
        &bob.account_id,
        &asset,
        1_000,
        &members,
    );
    set_context(alice.account_id.clone(), t0);
    let _ = contract.create_circle(
        "non_creator_settle".into(),
        asset,
        members,
        0,
        bob.account_id.clone(),
        sha256_hex("bob"),
        U128(1_000),
        Some(alice.sign_webauthn(&agree_p, false)),
    );
    let _ = contract.sign_circle_terms(
        "non_creator_settle".into(),
        1,
        bob.sign_webauthn(&agree_p, false),
    );
    set_context("intents.near".parse().unwrap(), t0 + 10);
    let _ = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![bob.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(500)],
        serde_json_msg_circle("non_creator_settle"),
    );

    let settle_p = canonical_circle_settle_payload(&cid_acct, "non_creator_settle", &bob.account_id, 500);
    set_context(bob.account_id.clone(), t0 + 20);
    let _ = contract.settle_circle("non_creator_settle".into(), bob.sign_webauthn(&settle_p, false));
}

#[test]
#[should_panic(expected = "Invalid creator signature")]
fn security_rejects_high_s_p256_malleability() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, _, cid_acct) = setup_contract(t0);
    let alice = PasskeyActor::new("alice.uprail.near", 141);
    let asset = AssetSpec::Intents {
        token_id: "nep141:gtusdcp.near".to_string(),
    };
    let members = vec![CircleMemberInput {
        account_id: alice.account_id.clone(),
        pubkey: alice.pubkey_near.clone(),
        share_bps: 10_000,
    }];
    let agree_p = canonical_circle_agree_payload(
        &cid_acct,
        "high_s_test",
        &alice.account_id,
        &alice.account_id,
        &asset,
        1_000,
        &members,
    );
    set_context(alice.account_id.clone(), t0);
    let _ = contract.create_circle(
        "high_s_test".into(),
        asset,
        members,
        0,
        alice.account_id.clone(),
        sha256_hex("alice"),
        U128(1_000),
        Some(alice.sign_webauthn(&agree_p, true)),
    );
}

#[test]
#[should_panic(expected = "Invalid member signature")]
fn security_rejects_wrong_webauthn_origin() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, _, cid_acct) = setup_contract(t0);
    let alice = PasskeyActor::new("alice.uprail.near", 151);
    let bob = PasskeyActor::new("bob.uprail.near", 152);
    let asset = AssetSpec::Intents {
        token_id: "nep141:gtusdcp.near".to_string(),
    };
    let members = vec![
        CircleMemberInput {
            account_id: alice.account_id.clone(),
            pubkey: alice.pubkey_near.clone(),
            share_bps: 5000,
        },
        CircleMemberInput {
            account_id: bob.account_id.clone(),
            pubkey: bob.pubkey_near.clone(),
            share_bps: 5000,
        },
    ];
    let agree_p = canonical_circle_agree_payload(
        &cid_acct,
        "origin_test",
        &alice.account_id,
        &bob.account_id,
        &asset,
        1_000,
        &members,
    );
    set_context(alice.account_id.clone(), t0);
    let _ = contract.create_circle(
        "origin_test".into(),
        asset,
        members,
        0,
        bob.account_id.clone(),
        sha256_hex("bob"),
        U128(1_000),
        Some(alice.sign_webauthn(&agree_p, false)),
    );

    let bad_proof = match bob.sign_webauthn(&agree_p, false) {
        AuthProof::WebAuthn(mut w) => {
            w.client_data_json = w.client_data_json.replace(ORIGIN, "https://evil-phish.example");
            AuthProof::WebAuthn(w)
        }
        _ => panic!("expected webauthn"),
    };
    // Re-sign is irrelevant since challenge + clientDataJSON must validate origin first
    let _ = contract.sign_circle_terms("origin_test".into(), 1, bad_proof);
}

#[test]
#[should_panic(expected = "Gift timelock has not expired yet")]
fn security_rejects_early_gift_claim_before_timelock() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, attestor_sk, cid_acct) = setup_contract(t0);
    let sender = PasskeyActor::new("sender.uprail.near", 161);
    let recip = PasskeyActor::new("recip.uprail.near", 162);
    let handle_hash = sha256_hex("recip");
    let unlock_at = t0 + 60_000;
    let gift_msg = format!(
        r#"{{"action":"create_and_fund_gift","gift_id":"early_gift","sender_pubkey":"{}","recipient_handle_hash":"{}","recipient_pubkey":"{}","unlock_at_ms":{},"reclaim_after_ms":{}}}"#,
        sender.pubkey_near,
        handle_hash,
        recip.pubkey_near,
        unlock_at,
        unlock_at + 100_000
    );
    set_context("intents.near".parse().unwrap(), t0);
    let _ = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![sender.account_id.clone()],
        vec!["nep141:tlo.near".to_string()],
        vec![U128(500_000)],
        gift_msg,
    );

    let deadline = unlock_at + 5_000;
    let attest_p =
        canonical_gift_claim_payload(&cid_acct, "early_gift", &handle_hash, &recip.account_id, deadline);
    let attest_sig = sign_ed(&attestor_sk, &attest_p);
    let recip_p = canonical_gift_recipient_payload(&cid_acct, "early_gift", &recip.account_id);
    set_context(recip.account_id.clone(), unlock_at - 1);
    let _ = contract.claim_gift(
        "early_gift".into(),
        recip.account_id.clone(),
        deadline,
        attest_sig,
        Some(recip.sign_webauthn(&recip_p, false)),
    );
}

#[test]
fn security_retry_settlement_and_partial_dissolve_never_double_pay() {
    let t0 = 1_750_000_000_000u64;
    let (mut contract, _, cid_acct) = setup_contract(t0);
    let alice = PasskeyActor::new("alice.uprail.near", 171);
    let bob = PasskeyActor::new("bob.uprail.near", 172);
    let payout: AccountId = "payout.uprail.near".parse().unwrap();
    let asset = AssetSpec::Intents {
        token_id: "nep141:gtusdcp.near".to_string(),
    };
    let members = vec![
        CircleMemberInput {
            account_id: alice.account_id.clone(),
            pubkey: alice.pubkey_near.clone(),
            share_bps: 5000,
        },
        CircleMemberInput {
            account_id: bob.account_id.clone(),
            pubkey: bob.pubkey_near.clone(),
            share_bps: 5000,
        },
    ];

    // 1. Settle retry when payout succeeded (99%) but fee failed (1%)
    let agree_1 = canonical_circle_agree_payload(
        &cid_acct,
        "retry_settle",
        &alice.account_id,
        &payout,
        &asset,
        1_000_000,
        &members,
    );
    set_context(alice.account_id.clone(), t0);
    let _ = contract.create_circle(
        "retry_settle".into(),
        asset.clone(),
        members.clone(),
        0,
        payout.clone(),
        sha256_hex("payout"),
        U128(1_000_000),
        Some(alice.sign_webauthn(&agree_1, false)),
    );
    let _ = contract.sign_circle_terms("retry_settle".into(), 1, bob.sign_webauthn(&agree_1, false));
    set_context("intents.near".parse().unwrap(), t0 + 10);
    let _ = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![alice.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(1_000_000)],
        serde_json_msg_circle("retry_settle"),
    );

    let settle_p = canonical_circle_settle_payload(&cid_acct, "retry_settle", &payout, 1_000_000);
    set_context(alice.account_id.clone(), t0 + 20);
    let _ = contract.settle_circle("retry_settle".into(), alice.sign_webauthn(&settle_p, false));
    set_callback_context(true, t0 + 21);
    let _ = contract.on_circle_settle_payout("retry_settle".into());
    set_callback_context(false, t0 + 22);
    contract.on_circle_settle_fee("retry_settle".into());

    let c_mid = contract.get_circle("retry_settle".into()).unwrap();
    assert_eq!(c_mid.status, CircleStatus::Settling);
    assert!(c_mid.payout_paid);
    assert!(!c_mid.fee_paid);

    set_context(bob.account_id.clone(), t0 + 23);
    let _ = contract.retry_circle_settlement("retry_settle".into());
    set_callback_context(true, t0 + 24);
    contract.on_circle_settle_fee("retry_settle".into());
    let c_done = contract.get_circle("retry_settle".into()).unwrap();
    assert_eq!(c_done.status, CircleStatus::Settled);
    assert!(c_done.payout_paid && c_done.fee_paid);

    // 2. Partial dissolve failure: member 0 succeeds, member 1 fails -> retry only refunds member 1
    let agree_2 = canonical_circle_agree_payload(
        &cid_acct,
        "retry_dissolve",
        &alice.account_id,
        &payout,
        &asset,
        1_000_000,
        &members,
    );
    set_context(alice.account_id.clone(), t0);
    let _ = contract.create_circle(
        "retry_dissolve".into(),
        asset,
        members,
        0,
        payout,
        sha256_hex("payout"),
        U128(1_000_000),
        Some(alice.sign_webauthn(&agree_2, false)),
    );
    let _ = contract.sign_circle_terms("retry_dissolve".into(), 1, bob.sign_webauthn(&agree_2, false));
    set_context("intents.near".parse().unwrap(), t0 + 10);
    let _ = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![alice.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(400_000)],
        serde_json_msg_circle("retry_dissolve"),
    );
    let _ = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![bob.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(600_000)],
        serde_json_msg_circle("retry_dissolve"),
    );

    let dis_p = canonical_circle_dissolve_payload(&cid_acct, "retry_dissolve");
    set_context(alice.account_id.clone(), t0 + 20);
    let _ = contract.initiate_dissolve("retry_dissolve".into(), 0, alice.sign_webauthn(&dis_p, false));
    let _ = contract.sign_dissolve("retry_dissolve".into(), 1, bob.sign_webauthn(&dis_p, false));
    let _ = contract.finalize_dissolve("retry_dissolve".into(), None);

    set_callback_context(true, t0 + 21);
    contract.on_circle_member_refund("retry_dissolve".into(), 0, U128(400_000));
    set_callback_context(false, t0 + 21);
    contract.on_circle_member_refund("retry_dissolve".into(), 1, U128(600_000));

    let mid_d = contract.get_circle("retry_dissolve".into()).unwrap();
    assert_eq!(mid_d.status, CircleStatus::Dissolving);
    assert_eq!(mid_d.members[0].refunded_amount.0, 400_000);
    assert_eq!(mid_d.members[0].contributed.0, 0);
    assert_eq!(mid_d.members[1].contributed.0, 600_000);

    set_context(bob.account_id.clone(), t0 + 22);
    let _ = contract.finalize_dissolve("retry_dissolve".into(), None);
    set_callback_context(true, t0 + 23);
    contract.on_circle_member_refund("retry_dissolve".into(), 1, U128(600_000));
    let done_d = contract.get_circle("retry_dissolve".into()).unwrap();
    assert_eq!(done_d.status, CircleStatus::Dissolved);
    assert_eq!(done_d.members[0].refunded_amount.0, 400_000);
    assert_eq!(done_d.members[1].refunded_amount.0, 600_000);
}

#[test]
fn migrate_and_update_config_preserve_escrowed_circles_gifts_and_sends() {
    let t0 = 1_700_000_000_000;
    let (mut contract, _attestor_sk, cid_acct) = setup_contract(t0);
    let alice = PasskeyActor::new("alice.near", 31);
    let bob = PasskeyActor::new("bob.near", 32);
    let payout: AccountId = "payout.near".parse().unwrap();
    let asset = AssetSpec::Intents {
        token_id: "nep141:gtusdcp.near".to_string(),
    };
    let members = vec![
        CircleMemberInput {
            account_id: alice.account_id.clone(),
            pubkey: alice.pubkey_near.clone(),
            share_bps: 5_000,
        },
        CircleMemberInput {
            account_id: bob.account_id.clone(),
            pubkey: bob.pubkey_near.clone(),
            share_bps: 5_000,
        },
    ];
    let agree_payload = canonical_circle_agree_payload(
        &cid_acct,
        "up_circle",
        &alice.account_id,
        &payout,
        &asset,
        1_000_000,
        &members,
    );
    set_context(alice.account_id.clone(), t0);
    let _ = contract.create_circle(
        "up_circle".into(),
        asset.clone(),
        members,
        0,
        payout,
        sha256_hex("payout"),
        U128(1_000_000),
        Some(alice.sign_webauthn(&agree_payload, false)),
    );
    let _ = contract.sign_circle_terms(
        "up_circle".into(),
        1,
        bob.sign_webauthn(&agree_payload, false),
    );

    set_context("intents.near".parse().unwrap(), t0 + 10);
    let _ = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![alice.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(500_000)],
        serde_json_msg_circle("up_circle"),
    );

    let gift_msg = near_sdk::serde_json::to_string(&DepositMsg::CreateAndFundGift {
        gift_id: "up_gift".into(),
        sender_pubkey: alice.pubkey_near.clone(),
        recipient_handle_hash: sha256_hex("bob"),
        recipient_pubkey: Some(bob.pubkey_near.clone()),
        unlock_at_ms: t0 + 1000,
        reclaim_after_ms: t0 + 100_000,
    })
    .unwrap();
    let _ = contract.mt_on_transfer(
        "intents.near".parse().unwrap(),
        vec![alice.account_id.clone()],
        vec!["nep141:gtusdcp.near".to_string()],
        vec![U128(250_000)],
        gift_msg,
    );

    // Flush LookupMaps + write root Borsh state as NEAR runtime does prior to contract upgrade,
    // then run `migrate()` with a rotated attestor pubkey & allowed origins.
    contract.circles.flush();
    contract.gifts.flush();
    contract.unclaimed_sends.flush();
    near_sdk::env::state_write(&contract);

    let (new_att_sk, new_att_pk) = make_ed_actor(77);
    set_context(cid_acct.clone(), t0 + 20);
    let mut migrated = CircleEscrowContract::migrate(
        None,
        None,
        Some(new_att_pk.clone()),
        Some(vec![ORIGIN.to_string(), "https://staging.uprail.world".to_string()]),
    );
    assert_eq!(migrated.get_version(), CONTRACT_VERSION);
    assert_eq!(migrated.get_config().attestor_pubkey, new_att_pk);
    assert_eq!(migrated.get_config().allowed_origins.len(), 2);

    // Escrowed Circle and Gift state remain intact and claimable under migrated config.
    let c = migrated.get_circle("up_circle".into()).unwrap();
    assert_eq!(c.total_contributed.0, 500_000);
    let g = migrated.get_gift("up_gift".into()).unwrap();
    assert_eq!(g.amount.0, 250_000);

    let attest_payload = canonical_gift_claim_payload(
        &cid_acct,
        "up_gift",
        &sha256_hex("bob"),
        &bob.account_id,
        t0 + 60_000,
    );
    let recip_payload = canonical_gift_recipient_payload(&cid_acct, "up_gift", &bob.account_id);
    set_context(bob.account_id.clone(), t0 + 2_000);
    let _ = migrated.claim_gift(
        "up_gift".into(),
        bob.account_id.clone(),
        t0 + 60_000,
        sign_ed(&new_att_sk, &attest_payload),
        Some(bob.sign_webauthn(&recip_payload, false)),
    );
    set_callback_context(true, t0 + 2_001);
    migrated.on_gift_payout("up_gift".into(), GiftStatus::Claimed);
    assert_eq!(migrated.get_gift("up_gift".into()).unwrap().status, GiftStatus::Claimed);

    // `update_config` works ONLY as #[private] (self-call) while Full Access Key exists.
    set_context(cid_acct.clone(), t0 + 2_002);
    migrated.update_config(None, Some("fee2.uprail.near".parse().unwrap()), None, None);
    assert_eq!(migrated.get_config().fee_collector.to_string(), "fee2.uprail.near");
}

#[test]
fn dissolve_16_member_circle_batches_refunds_without_exceeding_gas() {
    let t0 = 1_700_000_000_000;
    let (mut contract, _att, cid_acct) = setup_contract(t0);
    let actors: Vec<PasskeyActor> = (0..16)
        .map(|i| PasskeyActor::new(&format!("m{}.near", i), (50 + i) as u8))
        .collect();
    let members: Vec<CircleMemberInput> = actors
        .iter()
        .map(|a| CircleMemberInput {
            account_id: a.account_id.clone(),
            pubkey: a.pubkey_near.clone(),
            share_bps: 625, // 16 * 625 = 10_000 bps
        })
        .collect();
    let payout: AccountId = "payout16.near".parse().unwrap();
    let asset = AssetSpec::Intents {
        token_id: "nep141:gtusdcp.near".to_string(),
    };
    let agree_payload = canonical_circle_agree_payload(
        &cid_acct,
        "c16",
        &actors[0].account_id,
        &payout,
        &asset,
        1_600_000,
        &members,
    );

    set_context(actors[0].account_id.clone(), t0);
    let _ = contract.create_circle(
        "c16".into(),
        asset,
        members,
        0,
        payout,
        sha256_hex("payout16"),
        U128(1_600_000),
        Some(actors[0].sign_webauthn(&agree_payload, false)),
    );
    for (idx, actor) in actors.iter().enumerate().skip(1) {
        let _ = contract.sign_circle_terms(
            "c16".into(),
            idx as u16,
            actor.sign_webauthn(&agree_payload, false),
        );
    }

    set_context("intents.near".parse().unwrap(), t0 + 10);
    for actor in &actors {
        let _ = contract.mt_on_transfer(
            "intents.near".parse().unwrap(),
            vec![actor.account_id.clone()],
            vec!["nep141:gtusdcp.near".to_string()],
            vec![U128(100_000)],
            serde_json_msg_circle("c16"),
        );
    }
    assert_eq!(contract.get_circle("c16".into()).unwrap().total_contributed.0, 1_600_000);

    // Initiate dissolve + 7-day safeguard -> finalize executes in batches of MAX_DISSOLVE_REFUNDS_PER_TX (8)
    let dis_p = canonical_circle_dissolve_payload(&cid_acct, "c16");
    set_context(actors[0].account_id.clone(), t0 + 20);
    let _ = contract.initiate_dissolve("c16".into(), 0, actors[0].sign_webauthn(&dis_p, false));

    let after_safeguard = t0 + 20 + SEVEN_DAYS_MS;
    set_context(actors[1].account_id.clone(), after_safeguard);
    let _ = contract.finalize_dissolve("c16".into(), None);

    let after_batch1 = contract.get_circle("c16".into()).unwrap();
    assert_eq!(after_batch1.status, CircleStatus::Dissolving);
    let pending_batch1 = after_batch1.members.iter().filter(|m| m.refund_pending).count();
    assert_eq!(pending_batch1, MAX_DISSOLVE_REFUNDS_PER_TX);

    // Resolve batch 1 callbacks
    set_callback_context(true, after_safeguard + 1);
    for idx in 0..MAX_DISSOLVE_REFUNDS_PER_TX {
        contract.on_circle_member_refund("c16".into(), idx as u16, U128(100_000));
    }
    assert_eq!(contract.get_circle("c16".into()).unwrap().status, CircleStatus::Dissolving);

    // Second finalize_dissolve refunds members 8..16
    set_context(actors[9].account_id.clone(), after_safeguard + 2);
    let _ = contract.finalize_dissolve("c16".into(), None);
    set_callback_context(true, after_safeguard + 3);
    for idx in MAX_DISSOLVE_REFUNDS_PER_TX..16 {
        contract.on_circle_member_refund("c16".into(), idx as u16, U128(100_000));
    }

    let final_c = contract.get_circle("c16".into()).unwrap();
    assert_eq!(final_c.status, CircleStatus::Dissolved);
    assert_eq!(final_c.total_contributed.0, 0);
    assert!(final_c.members.iter().all(|m| m.refunded_amount.0 == 100_000 && m.contributed.0 == 0));
}

fn serde_json_msg_circle(circle_id: &str) -> String {
    format!(r#"{{"action":"contribute_circle","circle_id":"{}"}}"#, circle_id)
}
