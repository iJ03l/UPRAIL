use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::AccountId;

pub const SEVEN_DAYS_MS: u64 = 7 * 24 * 60 * 60 * 1000;
pub const MAX_CIRCLE_MEMBERS: usize = 16;
pub const MAX_ID_LEN: usize = 64;

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
#[serde(tag = "rail", rename_all = "snake_case")]
pub enum AssetSpec {
    /// Multi-Token asset held on the configured `intents.near` contract (e.g. `nep141:usdc.token.near`, Earn vault share tokens).
    Intents { token_id: String },
    /// Direct NEP-141 token held directly by this contract account.
    Nep141 { contract_id: AccountId },
}

impl AssetSpec {
    pub fn canonical_id(&self) -> String {
        match self {
            AssetSpec::Intents { token_id } => format!("intents:{}", token_id),
            AssetSpec::Nep141 { contract_id } => format!("nep141:{}", contract_id),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct WebAuthnProof {
    pub pubkey: String,
    pub authenticator_data: String,
    pub client_data_json: String,
    pub signature: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthProof {
    WebAuthn(WebAuthnProof),
    Ed25519 { pubkey: String, signature: String },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct CircleMemberInput {
    pub account_id: AccountId,
    /// `p256:<base58>` passkey public key or `ed25519:<base58>` public key.
    pub pubkey: String,
    pub share_bps: u16,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct CircleMember {
    pub account_id: AccountId,
    pub pubkey: String,
    pub share_bps: u16,
    pub agreed: bool,
    pub contributed: u128,
    pub refunded_amount: u128,
    pub dissolve_signed: bool,
    pub refund_pending: bool,
}

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CircleStatus {
    PendingSignatures,
    Active,
    Settling,
    Settled,
    Dissolving,
    Dissolved,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Circle {
    pub id: String,
    pub asset: AssetSpec,
    pub creator_index: u16,
    pub creator_account_id: AccountId,
    pub payout_account_id: AccountId,
    pub payout_handle_hash: String,
    pub target_amount: u128,
    pub members: Vec<CircleMember>,
    pub total_contributed: u128,
    pub status: CircleStatus,
    pub created_at_ms: u64,
    pub activated_at_ms: Option<u64>,
    pub settled_at_ms: Option<u64>,
    pub dissolve_started_at_ms: Option<u64>,
    pub dissolved_at_ms: Option<u64>,
    pub pending_payout_amount: u128,
    pub pending_fee_amount: u128,
    pub payout_paid: bool,
    pub fee_paid: bool,
    pub payout_in_flight: bool,
    pub fee_in_flight: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct CircleMemberView {
    pub account_id: AccountId,
    pub pubkey: String,
    pub share_bps: u16,
    pub agreed: bool,
    pub contributed: U128,
    pub refunded_amount: U128,
    pub dissolve_signed: bool,
    pub refund_pending: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct CircleView {
    pub id: String,
    pub asset: AssetSpec,
    pub creator_index: u16,
    pub creator_account_id: AccountId,
    pub payout_account_id: AccountId,
    pub payout_handle_hash: String,
    pub target_amount: U128,
    pub total_contributed: U128,
    pub status: CircleStatus,
    pub members: Vec<CircleMemberView>,
    pub created_at_ms: u64,
    pub activated_at_ms: Option<u64>,
    pub settled_at_ms: Option<u64>,
    pub dissolve_started_at_ms: Option<u64>,
    pub dissolve_safeguard_at_ms: Option<u64>,
    pub dissolved_at_ms: Option<u64>,
    pub payout_paid: bool,
    pub fee_paid: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct DissolveSig {
    pub member_index: u16,
    pub proof: AuthProof,
}

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GiftStatus {
    Locked,
    Claiming,
    Claimed,
    Reclaiming,
    Reclaimed,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Gift {
    pub id: String,
    pub sender_account_id: AccountId,
    pub sender_pubkey: String,
    pub recipient_handle_hash: String,
    pub recipient_pubkey: Option<String>,
    pub asset: AssetSpec,
    pub amount: u128,
    pub unlock_at_ms: u64,
    pub reclaim_after_ms: u64,
    pub status: GiftStatus,
    pub created_at_ms: u64,
    pub settled_at_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct GiftView {
    pub id: String,
    pub sender_account_id: AccountId,
    pub sender_pubkey: String,
    pub recipient_handle_hash: String,
    pub recipient_pubkey: Option<String>,
    pub asset: AssetSpec,
    pub amount: U128,
    pub unlock_at_ms: u64,
    pub reclaim_after_ms: u64,
    pub status: GiftStatus,
    pub created_at_ms: u64,
    pub settled_at_ms: Option<u64>,
}

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UnclaimedSendStatus {
    Pending,
    Claiming,
    Claimed,
    Refunding,
    Refunded,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct UnclaimedSend {
    pub id: String,
    pub sender_account_id: AccountId,
    pub sender_pubkey: String,
    pub recipient_handle_hash: String,
    pub asset: AssetSpec,
    pub amount: u128,
    pub created_at_ms: u64,
    pub refund_after_ms: u64,
    pub allow_early_cancel: bool,
    pub status: UnclaimedSendStatus,
    pub settled_at_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct UnclaimedSendView {
    pub id: String,
    pub sender_account_id: AccountId,
    pub sender_pubkey: String,
    pub recipient_handle_hash: String,
    pub asset: AssetSpec,
    pub amount: U128,
    pub created_at_ms: u64,
    pub refund_after_ms: u64,
    pub allow_early_cancel: bool,
    pub status: UnclaimedSendStatus,
    pub settled_at_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum DepositMsg {
    ContributeCircle {
        circle_id: String,
    },
    CreateAndFundGift {
        gift_id: String,
        sender_pubkey: String,
        recipient_handle_hash: String,
        recipient_pubkey: Option<String>,
        unlock_at_ms: u64,
        reclaim_after_ms: u64,
    },
    CreateUnclaimedSend {
        send_id: String,
        sender_pubkey: String,
        recipient_handle_hash: String,
        refund_after_ms: u64,
        #[serde(default = "default_true")]
        allow_early_cancel: bool,
    },
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct ContractConfigView {
    pub intents_contract: AccountId,
    pub fee_collector: AccountId,
    pub attestor_pubkey: String,
    pub allowed_origins: Vec<String>,
    pub dissolve_safeguard_ms: u64,
}
