use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, is_promise_success, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue,
};

mod crypto;
mod ext;
pub mod types;

use crypto::*;
use ext::{ext_ft, ext_intents};
pub use types::*;

const GAS_TOKEN_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_TRANSFER_CALLBACK: Gas = Gas::from_tgas(8);
const MAX_DISSOLVE_REFUNDS_PER_TX: usize = 8;
const CONTRACT_VERSION: u32 = 2;
const FEE_BPS: u128 = 100; // 1.00% protocol fee on Circle settlement payout
const BPS_DENOMINATOR: u128 = 10_000;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Circles,
    Gifts,
    UnclaimedSends,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CircleEscrowContract {
    intents_contract: AccountId,
    fee_collector: AccountId,
    attestor_pubkey: String,
    allowed_origins: Vec<String>,
    circles: LookupMap<String, Circle>,
    gifts: LookupMap<String, Gift>,
    unclaimed_sends: LookupMap<String, UnclaimedSend>,
}

#[near]
impl CircleEscrowContract {
    #[init]
    pub fn new(
        intents_contract: AccountId,
        fee_collector: AccountId,
        attestor_pubkey: String,
        allowed_origins: Option<Vec<String>>,
    ) -> Self {
        require!(
            parse_ed25519_key(&attestor_pubkey).is_ok(),
            "attestor_pubkey must be valid ed25519:<base58>"
        );
        Self {
            intents_contract,
            fee_collector,
            attestor_pubkey,
            allowed_origins: allowed_origins.unwrap_or_default(),
            circles: LookupMap::new(StorageKey::Circles),
            gifts: LookupMap::new(StorageKey::Gifts),
            unclaimed_sends: LookupMap::new(StorageKey::UnclaimedSends),
        }
    }

    /// Upgrade migration hook preserving existing LookupMap storage prefixes and state.
    /// Callable only by the contract itself while a Full Access Key exists.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(
        intents_contract: Option<AccountId>,
        fee_collector: Option<AccountId>,
        attestor_pubkey: Option<String>,
        allowed_origins: Option<Vec<String>>,
    ) -> Self {
        let mut state: Self =
            env::state_read().expect("Contract state must be initialized before migrating");
        if let Some(ic) = intents_contract {
            state.intents_contract = ic;
        }
        if let Some(fc) = fee_collector {
            state.fee_collector = fc;
        }
        if let Some(ak) = attestor_pubkey {
            require!(
                parse_ed25519_key(&ak).is_ok(),
                "attestor_pubkey must be valid ed25519:<base58>"
            );
            state.attestor_pubkey = ak;
        }
        if let Some(origins) = allowed_origins {
            state.allowed_origins = origins;
        }
        state
    }

    #[private]
    pub fn update_config(
        &mut self,
        intents_contract: Option<AccountId>,
        fee_collector: Option<AccountId>,
        attestor_pubkey: Option<String>,
        allowed_origins: Option<Vec<String>>,
    ) {
        if let Some(ic) = intents_contract {
            self.intents_contract = ic;
        }
        if let Some(fc) = fee_collector {
            self.fee_collector = fc;
        }
        if let Some(ak) = attestor_pubkey {
            require!(
                parse_ed25519_key(&ak).is_ok(),
                "attestor_pubkey must be valid ed25519:<base58>"
            );
            self.attestor_pubkey = ak;
        }
        if let Some(origins) = allowed_origins {
            self.allowed_origins = origins;
        }
    }

    // ─── Config & Views ───────────────────────────────────────────────────────

    pub fn get_version(&self) -> u32 {
        CONTRACT_VERSION
    }

    pub fn get_config(&self) -> ContractConfigView {
        ContractConfigView {
            intents_contract: self.intents_contract.clone(),
            fee_collector: self.fee_collector.clone(),
            attestor_pubkey: self.attestor_pubkey.clone(),
            allowed_origins: self.allowed_origins.clone(),
            dissolve_safeguard_ms: SEVEN_DAYS_MS,
        }
    }

    pub fn get_circle(&self, circle_id: String) -> Option<CircleView> {
        self.circles.get(&circle_id).map(|c| CircleView {
            id: c.id.clone(),
            asset: c.asset.clone(),
            creator_index: c.creator_index,
            creator_account_id: c.creator_account_id.clone(),
            payout_account_id: c.payout_account_id.clone(),
            payout_handle_hash: c.payout_handle_hash.clone(),
            target_amount: U128(c.target_amount),
            total_contributed: U128(c.total_contributed),
            status: c.status,
            members: c
                .members
                .iter()
                .map(|m| CircleMemberView {
                    account_id: m.account_id.clone(),
                    pubkey: m.pubkey.clone(),
                    share_bps: m.share_bps,
                    agreed: m.agreed,
                    contributed: U128(m.contributed),
                    refunded_amount: U128(m.refunded_amount),
                    dissolve_signed: m.dissolve_signed,
                    refund_pending: m.refund_pending,
                })
                .collect(),
            created_at_ms: c.created_at_ms,
            activated_at_ms: c.activated_at_ms,
            settled_at_ms: c.settled_at_ms,
            dissolve_started_at_ms: c.dissolve_started_at_ms,
            dissolve_safeguard_at_ms: c.dissolve_started_at_ms.map(|t| t.saturating_add(SEVEN_DAYS_MS)),
            dissolved_at_ms: c.dissolved_at_ms,
            payout_paid: c.payout_paid,
            fee_paid: c.fee_paid,
        })
    }

    pub fn get_gift(&self, gift_id: String) -> Option<GiftView> {
        self.gifts.get(&gift_id).map(|g| GiftView {
            id: g.id.clone(),
            sender_account_id: g.sender_account_id.clone(),
            sender_pubkey: g.sender_pubkey.clone(),
            recipient_handle_hash: g.recipient_handle_hash.clone(),
            recipient_pubkey: g.recipient_pubkey.clone(),
            asset: g.asset.clone(),
            amount: U128(g.amount),
            unlock_at_ms: g.unlock_at_ms,
            reclaim_after_ms: g.reclaim_after_ms,
            status: g.status,
            created_at_ms: g.created_at_ms,
            settled_at_ms: g.settled_at_ms,
        })
    }

    pub fn get_unclaimed_send(&self, send_id: String) -> Option<UnclaimedSendView> {
        self.unclaimed_sends.get(&send_id).map(|s| UnclaimedSendView {
            id: s.id.clone(),
            sender_account_id: s.sender_account_id.clone(),
            sender_pubkey: s.sender_pubkey.clone(),
            recipient_handle_hash: s.recipient_handle_hash.clone(),
            asset: s.asset.clone(),
            amount: U128(s.amount),
            created_at_ms: s.created_at_ms,
            refund_after_ms: s.refund_after_ms,
            allow_early_cancel: s.allow_early_cancel,
            status: s.status,
            settled_at_ms: s.settled_at_ms,
        })
    }

    // ─── Circles Lifecycle ────────────────────────────────────────────────────

    pub fn create_circle(
        &mut self,
        circle_id: String,
        asset: AssetSpec,
        members: Vec<CircleMemberInput>,
        creator_index: u16,
        payout_account_id: AccountId,
        payout_handle_hash: String,
        target_amount: U128,
        creator_proof: Option<AuthProof>,
    ) -> CircleView {
        validate_id(&circle_id);
        validate_handle_hash(&payout_handle_hash);
        require!(!self.circles.contains_key(&circle_id), "Circle already exists");
        require!(target_amount.0 > 0, "target_amount must be positive");
        require!(
            !members.is_empty() && members.len() <= MAX_CIRCLE_MEMBERS,
            "Invalid member count"
        );
        let creator_idx = creator_index as usize;
        require!(creator_idx < members.len(), "Invalid creator_index");

        let mut total_bps: u32 = 0;
        let mut seen_accounts: Vec<&AccountId> = Vec::with_capacity(members.len());
        let mut seen_pubkeys: Vec<&String> = Vec::with_capacity(members.len());
        for m in &members {
            validate_signer_pubkey(&m.pubkey);
            require!(m.share_bps > 0 && m.share_bps <= 10_000, "Member share_bps must be positive");
            require!(!seen_accounts.contains(&&m.account_id), "Duplicate member account_id");
            require!(!seen_pubkeys.contains(&&m.pubkey), "Duplicate member pubkey");
            seen_accounts.push(&m.account_id);
            seen_pubkeys.push(&m.pubkey);
            total_bps += m.share_bps as u32;
        }
        require!(total_bps == 10_000, "Member share_bps must sum to 10000");

        let creator_account_id = members[creator_idx].account_id.clone();
        let contract_id = env::current_account_id();
        let canonical = canonical_circle_agree_payload(
            &contract_id,
            &circle_id,
            &creator_account_id,
            &payout_account_id,
            &asset,
            target_amount.0,
            &members,
        );

        let mut creator_signed = false;
        if let Some(proof) = creator_proof {
            require!(
                verify_auth_proof(
                    &members[creator_idx].pubkey,
                    &canonical,
                    &proof,
                    &self.allowed_origins
                ),
                "Invalid creator signature over Circle terms"
            );
            creator_signed = true;
        }

        let now_ms = env::block_timestamp_ms();
        let stored_members: Vec<CircleMember> = members
            .into_iter()
            .enumerate()
            .map(|(i, m)| CircleMember {
                account_id: m.account_id,
                pubkey: m.pubkey,
                share_bps: m.share_bps,
                agreed: i == creator_idx && creator_signed,
                contributed: 0,
                refunded_amount: 0,
                dissolve_signed: false,
                refund_pending: false,
            })
            .collect();

        let all_agreed = stored_members.iter().all(|m| m.agreed);
        let status = if all_agreed {
            CircleStatus::Active
        } else {
            CircleStatus::PendingSignatures
        };

        let circle = Circle {
            id: circle_id.clone(),
            asset,
            creator_index,
            creator_account_id,
            payout_account_id,
            payout_handle_hash,
            target_amount: target_amount.0,
            members: stored_members,
            total_contributed: 0,
            status,
            created_at_ms: now_ms,
            activated_at_ms: if all_agreed { Some(now_ms) } else { None },
            settled_at_ms: None,
            dissolve_started_at_ms: None,
            dissolved_at_ms: None,
            pending_payout_amount: 0,
            pending_fee_amount: 0,
            payout_paid: false,
            fee_paid: false,
            payout_in_flight: false,
            fee_in_flight: false,
        };

        self.circles.insert(circle_id.clone(), circle);
        self.get_circle(circle_id).unwrap()
    }

    pub fn sign_circle_terms(
        &mut self,
        circle_id: String,
        member_index: u16,
        proof: AuthProof,
    ) -> CircleView {
        let mut circle = self
            .circles
            .get(&circle_id)
            .expect("Circle not found")
            .clone();
        require!(
            circle.status == CircleStatus::PendingSignatures,
            "Circle is not awaiting member signatures"
        );
        let idx = member_index as usize;
        require!(idx < circle.members.len(), "Invalid member_index");
        require!(!circle.members[idx].agreed, "Member already signed Circle terms");

        let inputs: Vec<CircleMemberInput> = circle
            .members
            .iter()
            .map(|m| CircleMemberInput {
                account_id: m.account_id.clone(),
                pubkey: m.pubkey.clone(),
                share_bps: m.share_bps,
            })
            .collect();

        let payload = canonical_circle_agree_payload(
            &env::current_account_id(),
            &circle.id,
            &circle.creator_account_id,
            &circle.payout_account_id,
            &circle.asset,
            circle.target_amount,
            &inputs,
        );
        require!(
            verify_auth_proof(
                &circle.members[idx].pubkey,
                &payload,
                &proof,
                &self.allowed_origins
            ),
            "Invalid member signature over Circle terms"
        );

        circle.members[idx].agreed = true;
        if circle.members.iter().all(|m| m.agreed) {
            circle.status = CircleStatus::Active;
            circle.activated_at_ms = Some(env::block_timestamp_ms());
        }
        self.circles.insert(circle_id.clone(), circle);
        self.get_circle(circle_id).unwrap()
    }

    pub fn settle_circle(&mut self, circle_id: String, creator_proof: AuthProof) -> Promise {
        let mut circle = self
            .circles
            .get(&circle_id)
            .expect("Circle not found")
            .clone();
        require!(
            circle.status == CircleStatus::Active,
            "Circle must be ACTIVE to settle"
        );
        require!(
            circle.total_contributed > 0,
            "Circle has no contributed funds to settle"
        );

        let creator = &circle.members[circle.creator_index as usize];
        let payload = canonical_circle_settle_payload(
            &env::current_account_id(),
            &circle.id,
            &circle.payout_account_id,
            circle.total_contributed,
        );
        require!(
            verify_auth_proof(&creator.pubkey, &payload, &creator_proof, &self.allowed_origins),
            "Invalid creator settlement signature"
        );

        let fee = circle
            .total_contributed
            .checked_mul(FEE_BPS)
            .expect("Fee calculation overflow")
            / BPS_DENOMINATOR;
        let payout = circle.total_contributed - fee;
        require!(payout > 0, "Net payout must be positive");

        circle.status = CircleStatus::Settling;
        circle.pending_payout_amount = payout;
        circle.pending_fee_amount = fee;
        circle.payout_paid = false;
        circle.fee_paid = fee == 0;
        circle.payout_in_flight = true;
        circle.fee_in_flight = false;

        let asset = circle.asset.clone();
        let payout_receiver = circle.payout_account_id.clone();
        self.circles.insert(circle_id.clone(), circle);

        self.transfer_asset(&asset, payout_receiver, payout, Some(format!("uprail:circle_settle:{}", circle_id)))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(
                        GAS_TRANSFER_CALLBACK
                            .saturating_add(GAS_TOKEN_TRANSFER)
                            .saturating_add(GAS_TRANSFER_CALLBACK),
                    )
                    .on_circle_settle_payout(circle_id),
            )
    }

    /// Permissionless retry in case the payout or 1% fee cross-contract call failed earlier.
    pub fn retry_circle_settlement(&mut self, circle_id: String) -> Promise {
        let mut circle = self
            .circles
            .get(&circle_id)
            .expect("Circle not found")
            .clone();
        require!(
            circle.status == CircleStatus::Settling,
            "Circle settlement is not pending"
        );
        require!(
            !circle.payout_in_flight && !circle.fee_in_flight,
            "Settlement transfer already in flight"
        );

        let asset = circle.asset.clone();
        if !circle.payout_paid {
            let payout = circle.pending_payout_amount;
            let receiver = circle.payout_account_id.clone();
            circle.payout_in_flight = true;
            self.circles.insert(circle_id.clone(), circle);
            return self
                .transfer_asset(&asset, receiver, payout, Some(format!("uprail:circle_settle:{}", circle_id)))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(
                        GAS_TRANSFER_CALLBACK
                            .saturating_add(GAS_TOKEN_TRANSFER)
                            .saturating_add(GAS_TRANSFER_CALLBACK),
                    )
                        .on_circle_settle_payout(circle_id),
                );
        }

        require!(!circle.fee_paid && circle.pending_fee_amount > 0, "Nothing left to settle");
        let fee = circle.pending_fee_amount;
        circle.fee_in_flight = true;
        self.circles.insert(circle_id.clone(), circle);
        self.transfer_asset(
            &asset,
            self.fee_collector.clone(),
            fee,
            Some(format!("uprail:circle_fee:{}", circle_id)),
        )
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_TRANSFER_CALLBACK)
                .on_circle_settle_fee(circle_id),
        )
    }

    pub fn initiate_dissolve(
        &mut self,
        circle_id: String,
        member_index: u16,
        proof: AuthProof,
    ) -> CircleView {
        let mut circle = self
            .circles
            .get(&circle_id)
            .expect("Circle not found")
            .clone();
        require!(
            circle.status == CircleStatus::PendingSignatures
                || circle.status == CircleStatus::Active,
            "Circle cannot initiate dissolve in current status"
        );
        let idx = member_index as usize;
        require!(idx < circle.members.len(), "Invalid member_index");

        let is_creator = idx == circle.creator_index as usize;
        let is_funded_contributor = circle.members[idx].contributed > 0;
        require!(
            is_creator || is_funded_contributor,
            "Only the creator or a funded contributor can initiate dissolve"
        );

        let payload = canonical_circle_dissolve_payload(&env::current_account_id(), &circle.id);
        require!(
            verify_auth_proof(
                &circle.members[idx].pubkey,
                &payload,
                &proof,
                &self.allowed_origins
            ),
            "Invalid dissolve signature"
        );

        let now_ms = env::block_timestamp_ms();
        if circle.total_contributed == 0 {
            circle.status = CircleStatus::Dissolved;
            circle.dissolved_at_ms = Some(now_ms);
        } else {
            circle.members[idx].dissolve_signed = true;
            circle.status = CircleStatus::Dissolving;
            circle.dissolve_started_at_ms = Some(now_ms);
        }
        self.circles.insert(circle_id.clone(), circle);
        self.get_circle(circle_id).unwrap()
    }

    pub fn sign_dissolve(
        &mut self,
        circle_id: String,
        member_index: u16,
        proof: AuthProof,
    ) -> CircleView {
        let mut circle = self
            .circles
            .get(&circle_id)
            .expect("Circle not found")
            .clone();
        require!(
            circle.status == CircleStatus::Dissolving,
            "Circle is not in DISSOLVING status"
        );
        let idx = member_index as usize;
        require!(idx < circle.members.len(), "Invalid member_index");

        let payload = canonical_circle_dissolve_payload(&env::current_account_id(), &circle.id);
        require!(
            verify_auth_proof(
                &circle.members[idx].pubkey,
                &payload,
                &proof,
                &self.allowed_origins
            ),
            "Invalid member dissolve signature"
        );

        circle.members[idx].dissolve_signed = true;
        self.circles.insert(circle_id.clone(), circle);
        self.get_circle(circle_id).unwrap()
    }

    /// Executes 0%-fee pro-rata dissolve refunds once either EVERY funded
    /// contributor has signed, or the 7-day safeguard timer has elapsed.
    pub fn finalize_dissolve(
        &mut self,
        circle_id: String,
        sigs: Option<Vec<DissolveSig>>,
    ) -> PromiseOrValue<CircleView> {
        let mut circle = self
            .circles
            .get(&circle_id)
            .expect("Circle not found")
            .clone();

        if let Some(batch) = sigs {
            require!(!batch.is_empty(), "Batch dissolve signatures cannot be empty");
            require!(
                circle.status == CircleStatus::Active
                    || circle.status == CircleStatus::PendingSignatures
                    || circle.status == CircleStatus::Dissolving,
                "Circle cannot dissolve in current status"
            );
            let payload = canonical_circle_dissolve_payload(&env::current_account_id(), &circle.id);
            let mut has_initiator = false;
            for item in batch {
                let idx = item.member_index as usize;
                require!(idx < circle.members.len(), "Invalid member_index");
                require!(
                    verify_auth_proof(
                        &circle.members[idx].pubkey,
                        &payload,
                        &item.proof,
                        &self.allowed_origins
                    ),
                    "Invalid batch dissolve signature"
                );
                if idx == circle.creator_index as usize || circle.members[idx].contributed > 0 {
                    has_initiator = true;
                }
                circle.members[idx].dissolve_signed = true;
            }
            if circle.status != CircleStatus::Dissolving {
                require!(
                    has_initiator,
                    "Batch dissolve must include creator or a funded contributor"
                );
                circle.status = CircleStatus::Dissolving;
                if circle.dissolve_started_at_ms.is_none() {
                    circle.dissolve_started_at_ms = Some(env::block_timestamp_ms());
                }
            }
        }

        require!(
            circle.status == CircleStatus::Dissolving,
            "Circle must be DISSOLVING before finalizing"
        );

        let now_ms = env::block_timestamp_ms();
        let all_contributors_signed = circle
            .members
            .iter()
            .filter(|m| m.contributed > 0 || m.refunded_amount > 0)
            .all(|m| m.dissolve_signed);
        let safeguard_elapsed = circle
            .dissolve_started_at_ms
            .map(|t| now_ms >= t.saturating_add(SEVEN_DAYS_MS))
            .unwrap_or(false);

        require!(
            all_contributors_signed || safeguard_elapsed,
            "All funded contributors must sign dissolve, or wait 7 days from dissolve start"
        );

        if circle.total_contributed == 0 {
            circle.status = CircleStatus::Dissolved;
            circle.dissolved_at_ms = Some(now_ms);
            self.circles.insert(circle_id.clone(), circle);
            return PromiseOrValue::Value(self.get_circle(circle_id).unwrap());
        }

        let asset = circle.asset.clone();
        let mut combined: Option<Promise> = None;
        let mut dispatched: usize = 0;

        for idx in 0..circle.members.len() {
            if dispatched >= MAX_DISSOLVE_REFUNDS_PER_TX {
                break;
            }
            let amt = circle.members[idx].contributed;
            if amt > 0 && !circle.members[idx].refund_pending {
                circle.members[idx].refund_pending = true;
                dispatched += 1;
                let receiver = circle.members[idx].account_id.clone();
                let p = self
                    .transfer_asset(
                        &asset,
                        receiver,
                        amt,
                        Some(format!("uprail:circle_dissolve:{}", circle_id)),
                    )
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_TRANSFER_CALLBACK)
                            .on_circle_member_refund(circle_id.clone(), idx as u16, U128(amt)),
                    );
                combined = Some(match combined {
                    Some(prev) => prev.and(p),
                    None => p,
                });
            }
        }

        self.circles.insert(circle_id.clone(), circle);
        match combined {
            Some(p) => PromiseOrValue::Promise(p),
            None => PromiseOrValue::Value(self.get_circle(circle_id).unwrap()),
        }
    }

    // ─── Earn Vault Gifts ─────────────────────────────────────────────────────

    pub fn claim_gift(
        &mut self,
        gift_id: String,
        recipient_account_id: AccountId,
        attestor_deadline_ms: u64,
        attestor_sig: String,
        recipient_proof: Option<AuthProof>,
    ) -> Promise {
        let mut gift = self.gifts.get(&gift_id).expect("Gift not found").clone();
        require!(gift.status == GiftStatus::Locked, "Gift is not locked");
        let now_ms = env::block_timestamp_ms();
        require!(now_ms >= gift.unlock_at_ms, "Gift timelock has not expired yet");
        require!(now_ms <= attestor_deadline_ms, "Attestation signature expired");
        require!(gift.amount > 0, "Gift has zero balance");

        let contract_id = env::current_account_id();
        let attest_payload = canonical_gift_claim_payload(
            &contract_id,
            &gift.id,
            &gift.recipient_handle_hash,
            &recipient_account_id,
            attestor_deadline_ms,
        );
        require!(
            verify_ed25519_sig(&self.attestor_pubkey, &attest_payload, &attestor_sig),
            "Invalid handle attestor signature"
        );

        if let Some(ref expected_pk) = gift.recipient_pubkey {
            let proof = recipient_proof
                .as_ref()
                .expect("Recipient WebAuthn signature required for pinned gift");
            let recip_payload =
                canonical_gift_recipient_payload(&contract_id, &gift.id, &recipient_account_id);
            require!(
                verify_auth_proof(expected_pk, &recip_payload, proof, &self.allowed_origins),
                "Invalid recipient passkey signature"
            );
        }

        let amount = gift.amount;
        let asset = gift.asset.clone();
        gift.status = GiftStatus::Claiming;
        self.gifts.insert(gift_id.clone(), gift);

        self.transfer_asset(
            &asset,
            recipient_account_id,
            amount,
            Some(format!("uprail:gift_claim:{}", gift_id)),
        )
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_TRANSFER_CALLBACK)
                .on_gift_payout(gift_id, GiftStatus::Claimed),
        )
    }

    pub fn reclaim_gift(&mut self, gift_id: String, sender_proof: AuthProof) -> Promise {
        let mut gift = self.gifts.get(&gift_id).expect("Gift not found").clone();
        require!(gift.status == GiftStatus::Locked, "Gift is not locked");
        require!(
            env::block_timestamp_ms() >= gift.reclaim_after_ms,
            "Gift reclaim window has not been reached"
        );
        require!(gift.amount > 0, "Gift has zero balance");

        let payload = canonical_gift_reclaim_payload(
            &env::current_account_id(),
            &gift.id,
            &gift.sender_account_id,
        );
        require!(
            verify_auth_proof(&gift.sender_pubkey, &payload, &sender_proof, &self.allowed_origins),
            "Invalid sender reclaim signature"
        );

        let amount = gift.amount;
        let asset = gift.asset.clone();
        let sender_account = gift.sender_account_id.clone();
        gift.status = GiftStatus::Reclaiming;
        self.gifts.insert(gift_id.clone(), gift);

        self.transfer_asset(
            &asset,
            sender_account,
            amount,
            Some(format!("uprail:gift_reclaim:{}", gift_id)),
        )
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_TRANSFER_CALLBACK)
                .on_gift_payout(gift_id, GiftStatus::Reclaimed),
        )
    }

    // ─── Unclaimed @handle Sends ──────────────────────────────────────────────

    pub fn claim_unclaimed_send(
        &mut self,
        send_id: String,
        recipient_account_id: AccountId,
        attestor_deadline_ms: u64,
        attestor_sig: String,
    ) -> Promise {
        let mut send = self
            .unclaimed_sends
            .get(&send_id)
            .expect("Send not found")
            .clone();
        require!(send.status == UnclaimedSendStatus::Pending, "Send is not pending");
        let now_ms = env::block_timestamp_ms();
        require!(now_ms <= attestor_deadline_ms, "Attestation signature expired");
        require!(send.amount > 0, "Send has zero balance");

        let payload = canonical_unclaimed_claim_payload(
            &env::current_account_id(),
            &send.id,
            &send.recipient_handle_hash,
            &recipient_account_id,
            attestor_deadline_ms,
        );
        require!(
            verify_ed25519_sig(&self.attestor_pubkey, &payload, &attestor_sig),
            "Invalid handle attestor signature"
        );

        let amount = send.amount;
        let asset = send.asset.clone();
        send.status = UnclaimedSendStatus::Claiming;
        self.unclaimed_sends.insert(send_id.clone(), send);

        self.transfer_asset(
            &asset,
            recipient_account_id,
            amount,
            Some(format!("uprail:unclaimed_claim:{}", send_id)),
        )
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_TRANSFER_CALLBACK)
                .on_unclaimed_send_payout(send_id, UnclaimedSendStatus::Claimed),
        )
    }

    pub fn refund_unclaimed_send(&mut self, send_id: String, sender_proof: AuthProof) -> Promise {
        let mut send = self
            .unclaimed_sends
            .get(&send_id)
            .expect("Send not found")
            .clone();
        require!(send.status == UnclaimedSendStatus::Pending, "Send is not pending");
        require!(
            send.allow_early_cancel || env::block_timestamp_ms() >= send.refund_after_ms,
            "Send cannot be refunded before expiry"
        );
        require!(send.amount > 0, "Send has zero balance");

        let payload = canonical_unclaimed_refund_payload(
            &env::current_account_id(),
            &send.id,
            &send.sender_account_id,
        );
        require!(
            verify_auth_proof(&send.sender_pubkey, &payload, &sender_proof, &self.allowed_origins),
            "Invalid sender refund signature"
        );

        let amount = send.amount;
        let asset = send.asset.clone();
        let sender_account = send.sender_account_id.clone();
        send.status = UnclaimedSendStatus::Refunding;
        self.unclaimed_sends.insert(send_id.clone(), send);

        self.transfer_asset(
            &asset,
            sender_account,
            amount,
            Some(format!("uprail:unclaimed_refund:{}", send_id)),
        )
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_TRANSFER_CALLBACK)
                .on_unclaimed_send_payout(send_id, UnclaimedSendStatus::Refunded),
        )
    }

    // ─── Deposit Receivers (NEP-245 Intents + NEP-141) ────────────────────────

    pub fn mt_on_transfer(
        &mut self,
        #[allow(unused_variables)] sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        if env::predecessor_account_id() != self.intents_contract
            || token_ids.len() != 1
            || amounts.len() != 1
            || previous_owner_ids.len() != 1
            || amounts[0].0 == 0
        {
            return PromiseOrValue::Value(amounts);
        }

        let asset = AssetSpec::Intents {
            token_id: token_ids[0].clone(),
        };
        let depositor = previous_owner_ids[0].clone();
        if self.apply_deposit(&depositor, &asset, amounts[0].0, &msg).is_ok() {
            PromiseOrValue::Value(vec![U128(0)])
        } else {
            PromiseOrValue::Value(amounts)
        }
    }

    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if amount.0 == 0 {
            return PromiseOrValue::Value(amount);
        }
        let asset = AssetSpec::Nep141 {
            contract_id: env::predecessor_account_id(),
        };
        if self.apply_deposit(&sender_id, &asset, amount.0, &msg).is_ok() {
            PromiseOrValue::Value(U128(0))
        } else {
            PromiseOrValue::Value(amount)
        }
    }

    // ─── Internal Deposit & Cross-Contract Helpers ────────────────────────────

    fn apply_deposit(
        &mut self,
        depositor: &AccountId,
        asset: &AssetSpec,
        amount: u128,
        msg: &str,
    ) -> Result<(), &'static str> {
        let Ok(parsed) = near_sdk::serde_json::from_str::<DepositMsg>(msg) else {
            return Err("Invalid deposit msg JSON");
        };

        let now_ms = env::block_timestamp_ms();
        match parsed {
            DepositMsg::ContributeCircle { circle_id } => {
                let Some(mut circle) = self.circles.get(&circle_id).cloned() else {
                    return Err("Circle not found");
                };
                if circle.status != CircleStatus::Active || &circle.asset != asset {
                    return Err("Circle is not accepting deposits for this asset");
                }
                let Some(member_pos) = circle.members.iter().position(|m| &m.account_id == depositor) else {
                    return Err("Depositor is not a Circle member");
                };
                if !circle.members[member_pos].agreed {
                    return Err("Member has not signed Circle terms");
                }
                circle.members[member_pos].contributed = circle.members[member_pos]
                    .contributed
                    .checked_add(amount)
                    .ok_or("Member contribution overflow")?;
                circle.total_contributed = circle
                    .total_contributed
                    .checked_add(amount)
                    .ok_or("Circle total overflow")?;
                self.circles.insert(circle_id, circle);
                Ok(())
            }
            DepositMsg::CreateAndFundGift {
                gift_id,
                sender_pubkey,
                recipient_handle_hash,
                recipient_pubkey,
                unlock_at_ms,
                reclaim_after_ms,
            } => {
                if gift_id.is_empty()
                    || gift_id.len() > MAX_ID_LEN
                    || !gift_id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                    || self.gifts.contains_key(&gift_id)
                    || recipient_handle_hash.len() != 64
                    || !recipient_handle_hash.bytes().all(|b| b.is_ascii_hexdigit())
                    || reclaim_after_ms < unlock_at_ms
                {
                    return Err("Invalid gift creation parameters");
                }
                let pk_ok = if sender_pubkey.starts_with("p256:") {
                    parse_p256_compressed(&sender_pubkey).is_ok()
                } else if sender_pubkey.starts_with("ed25519:") {
                    parse_ed25519_key(&sender_pubkey).is_ok()
                } else {
                    false
                };
                if !pk_ok {
                    return Err("Invalid sender_pubkey");
                }
                if let Some(ref rpk) = recipient_pubkey {
                    let r_ok = if rpk.starts_with("p256:") {
                        parse_p256_compressed(rpk).is_ok()
                    } else if rpk.starts_with("ed25519:") {
                        parse_ed25519_key(rpk).is_ok()
                    } else {
                        false
                    };
                    if !r_ok {
                        return Err("Invalid recipient_pubkey");
                    }
                }
                let gift = Gift {
                    id: gift_id.clone(),
                    sender_account_id: depositor.clone(),
                    sender_pubkey,
                    recipient_handle_hash,
                    recipient_pubkey,
                    asset: asset.clone(),
                    amount,
                    unlock_at_ms,
                    reclaim_after_ms,
                    status: GiftStatus::Locked,
                    created_at_ms: now_ms,
                    settled_at_ms: None,
                };
                self.gifts.insert(gift_id, gift);
                Ok(())
            }
            DepositMsg::CreateUnclaimedSend {
                send_id,
                sender_pubkey,
                recipient_handle_hash,
                refund_after_ms,
                allow_early_cancel,
            } => {
                if send_id.is_empty()
                    || send_id.len() > MAX_ID_LEN
                    || !send_id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                    || self.unclaimed_sends.contains_key(&send_id)
                    || recipient_handle_hash.len() != 64
                    || !recipient_handle_hash.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err("Invalid unclaimed send parameters");
                }
                let pk_ok = if sender_pubkey.starts_with("p256:") {
                    parse_p256_compressed(&sender_pubkey).is_ok()
                } else if sender_pubkey.starts_with("ed25519:") {
                    parse_ed25519_key(&sender_pubkey).is_ok()
                } else {
                    false
                };
                if !pk_ok {
                    return Err("Invalid sender_pubkey");
                }
                let send = UnclaimedSend {
                    id: send_id.clone(),
                    sender_account_id: depositor.clone(),
                    sender_pubkey,
                    recipient_handle_hash,
                    asset: asset.clone(),
                    amount,
                    created_at_ms: now_ms,
                    refund_after_ms,
                    allow_early_cancel,
                    status: UnclaimedSendStatus::Pending,
                    settled_at_ms: None,
                };
                self.unclaimed_sends.insert(send_id, send);
                Ok(())
            }
        }
    }

    fn transfer_asset(
        &self,
        asset: &AssetSpec,
        receiver_id: AccountId,
        amount: u128,
        memo: Option<String>,
    ) -> Promise {
        match asset {
            AssetSpec::Intents { token_id } => ext_intents::ext(self.intents_contract.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_TOKEN_TRANSFER)
                .mt_transfer(receiver_id, token_id.clone(), U128(amount), None, memo),
            AssetSpec::Nep141 { contract_id } => ext_ft::ext(contract_id.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_TOKEN_TRANSFER)
                .ft_transfer(receiver_id, U128(amount), memo),
        }
    }

    // ─── Private Callbacks ────────────────────────────────────────────────────

    #[private]
    pub fn on_circle_settle_payout(&mut self, circle_id: String) -> PromiseOrValue<()> {
        let mut circle = self.circles.get(&circle_id).expect("Circle not found").clone();
        circle.payout_in_flight = false;

        if !is_promise_success() {
            // Only revert to Active if neither payout nor fee has left the contract.
            if !circle.payout_paid && !circle.fee_paid {
                circle.status = CircleStatus::Active;
            }
            self.circles.insert(circle_id, circle);
            return PromiseOrValue::Value(());
        }

        circle.payout_paid = true;
        if circle.fee_paid || circle.pending_fee_amount == 0 {
            circle.fee_paid = true;
            circle.status = CircleStatus::Settled;
            circle.total_contributed = 0;
            circle.settled_at_ms = Some(env::block_timestamp_ms());
            for m in &mut circle.members {
                m.contributed = 0;
            }
            self.circles.insert(circle_id, circle);
            return PromiseOrValue::Value(());
        }

        let fee = circle.pending_fee_amount;
        let asset = circle.asset.clone();
        circle.fee_in_flight = true;
        self.circles.insert(circle_id.clone(), circle);

        PromiseOrValue::Promise(
            self.transfer_asset(
                &asset,
                self.fee_collector.clone(),
                fee,
                Some(format!("uprail:circle_fee:{}", circle_id)),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_TRANSFER_CALLBACK)
                    .on_circle_settle_fee(circle_id),
            ),
        )
    }

    #[private]
    pub fn on_circle_settle_fee(&mut self, circle_id: String) {
        let mut circle = self.circles.get(&circle_id).expect("Circle not found").clone();
        circle.fee_in_flight = false;
        if is_promise_success() {
            circle.fee_paid = true;
            if circle.payout_paid {
                circle.status = CircleStatus::Settled;
                circle.total_contributed = 0;
                circle.settled_at_ms = Some(env::block_timestamp_ms());
                for m in &mut circle.members {
                    m.contributed = 0;
                }
            }
        }
        self.circles.insert(circle_id, circle);
    }

    #[private]
    pub fn on_circle_member_refund(
        &mut self,
        circle_id: String,
        member_index: u16,
        expected_amount: U128,
    ) {
        let mut circle = self.circles.get(&circle_id).expect("Circle not found").clone();
        let idx = member_index as usize;
        if idx < circle.members.len() {
            circle.members[idx].refund_pending = false;
            if is_promise_success() {
                let paid = expected_amount.0.min(circle.members[idx].contributed);
                circle.members[idx].contributed -= paid;
                circle.members[idx].refunded_amount =
                    circle.members[idx].refunded_amount.saturating_add(paid);
                circle.total_contributed = circle.total_contributed.saturating_sub(paid);
            }
        }
        if circle.total_contributed == 0 && circle.members.iter().all(|m| !m.refund_pending) {
            circle.status = CircleStatus::Dissolved;
            circle.dissolved_at_ms = Some(env::block_timestamp_ms());
        }
        self.circles.insert(circle_id, circle);
    }

    #[private]
    pub fn on_gift_payout(&mut self, gift_id: String, target_status: GiftStatus) {
        let mut gift = self.gifts.get(&gift_id).expect("Gift not found").clone();
        if is_promise_success() {
            gift.status = target_status;
            gift.amount = 0;
            gift.settled_at_ms = Some(env::block_timestamp_ms());
        } else {
            gift.status = GiftStatus::Locked;
        }
        self.gifts.insert(gift_id, gift);
    }

    #[private]
    pub fn on_unclaimed_send_payout(
        &mut self,
        send_id: String,
        target_status: UnclaimedSendStatus,
    ) {
        let mut send = self
            .unclaimed_sends
            .get(&send_id)
            .expect("Send not found")
            .clone();
        if is_promise_success() {
            send.status = target_status;
            send.amount = 0;
            send.settled_at_ms = Some(env::block_timestamp_ms());
        } else {
            send.status = UnclaimedSendStatus::Pending;
        }
        self.unclaimed_sends.insert(send_id, send);
    }
}

#[cfg(test)]
mod tests;
