use base64::{engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD}, Engine as _};
use near_sdk::serde::Deserialize;
use near_sdk::{env, require, AccountId};

use crate::types::{AssetSpec, AuthProof, CircleMemberInput, WebAuthnProof};

const DOMAIN: &str = "uprail:circle-escrow:v1";

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct CollectedClientData {
    #[serde(rename = "type")]
    typ: String,
    challenge: String,
    origin: String,
}

pub fn validate_id(id: &str) {
    require!(
        !id.is_empty()
            && id.len() <= crate::types::MAX_ID_LEN
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
        "Invalid identifier"
    );
}

pub fn validate_handle_hash(hash_hex: &str) {
    require!(
        hash_hex.len() == 64 && hash_hex.bytes().all(|b| b.is_ascii_hexdigit()),
        "recipient_handle_hash must be a 64-char hex SHA-256 digest"
    );
}

pub fn parse_p256_compressed(key_str: &str) -> Result<[u8; 33], &'static str> {
    let raw_b58 = key_str
        .strip_prefix("p256:")
        .ok_or("Expected p256:<base58> public key")?;
    let bytes = bs58::decode(raw_b58)
        .into_vec()
        .map_err(|_| "Invalid base58 in p256 public key")?;

    if bytes.len() == 64 {
        let mut out = [0u8; 33];
        out[0] = if bytes[63] & 1 == 0 { 0x02 } else { 0x03 };
        out[1..33].copy_from_slice(&bytes[0..32]);
        Ok(out)
    } else if bytes.len() == 33 && (bytes[0] == 0x02 || bytes[0] == 0x03) {
        let mut out = [0u8; 33];
        out.copy_from_slice(&bytes);
        Ok(out)
    } else {
        Err("p256 public key must be 64-byte x||y or 33-byte SEC1 compressed")
    }
}

pub fn parse_ed25519_key(key_str: &str) -> Result<[u8; 32], &'static str> {
    let raw_b58 = key_str
        .strip_prefix("ed25519:")
        .ok_or("Expected ed25519:<base58> public key")?;
    let bytes = bs58::decode(raw_b58)
        .into_vec()
        .map_err(|_| "Invalid base58 in ed25519 public key")?;
    if bytes.len() != 32 {
        return Err("ed25519 public key must be 32 bytes");
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

pub fn validate_signer_pubkey(key_str: &str) {
    if key_str.starts_with("p256:") {
        require!(parse_p256_compressed(key_str).is_ok(), "Invalid p256 pubkey");
    } else if key_str.starts_with("ed25519:") {
        require!(parse_ed25519_key(key_str).is_ok(), "Invalid ed25519 pubkey");
    } else {
        env::panic_str("Signer pubkey must start with p256: or ed25519:");
    }
}

fn decode_sig_64(sig_str: &str, prefix: &str) -> Result<[u8; 64], &'static str> {
    let encoded = sig_str.strip_prefix(prefix).unwrap_or(sig_str);
    let bytes = if sig_str.starts_with(prefix) {
        bs58::decode(encoded)
            .into_vec()
            .map_err(|_| "Invalid base58 signature")?
    } else {
        decode_b64url(encoded).map_err(|_| "Invalid base64url signature")?
    };
    if bytes.len() != 64 {
        return Err("Signature must be 64 bytes");
    }
    let mut out = [0u8; 64];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn decode_b64url(input: &str) -> Result<Vec<u8>, base64::DecodeError> {
    let trimmed = input.trim().trim_end_matches('=');
    URL_SAFE_NO_PAD
        .decode(trimmed)
        .or_else(|_| URL_SAFE.decode(input.trim()))
}

pub fn verify_webauthn_p256(
    expected_pubkey: &str,
    payload: &[u8],
    proof: &WebAuthnProof,
    allowed_origins: &[String],
) -> bool {
    if proof.pubkey != expected_pubkey {
        return false;
    }
    let Ok(compressed_pk) = parse_p256_compressed(expected_pubkey) else {
        return false;
    };
    let Ok(sig) = decode_sig_64(&proof.signature, "p256:") else {
        return false;
    };
    if !env::p256_signature_is_low_s(&sig) {
        return false;
    }

    let Ok(auth_data) = decode_b64url(&proof.authenticator_data) else {
        return false;
    };
    if auth_data.len() < 37 {
        return false;
    }
    let flags = auth_data[32];
    // UP bit (bit 0) must be set.
    if flags & 0x01 == 0 {
        return false;
    }
    // WebAuthn spec step 18: if BE (bit 3) is clear, BS (bit 4) must be clear.
    if (flags & 0x08 == 0) && (flags & 0x10 != 0) {
        return false;
    }

    let Ok(client_data) = near_sdk::serde_json::from_str::<CollectedClientData>(&proof.client_data_json)
    else {
        return false;
    };
    if client_data.typ != "webauthn.get" {
        return false;
    }
    if !allowed_origins.is_empty() && !allowed_origins.iter().any(|o| o == &client_data.origin) {
        return false;
    }

    let expected_challenge = env::sha256_array(payload);
    let Ok(decoded_challenge) = decode_b64url(&client_data.challenge) else {
        return false;
    };
    if decoded_challenge.as_slice() != expected_challenge {
        return false;
    }

    let client_data_hash = env::sha256_array(proof.client_data_json.as_bytes());
    let mut signed_msg = Vec::with_capacity(auth_data.len() + 32);
    signed_msg.extend_from_slice(&auth_data);
    signed_msg.extend_from_slice(&client_data_hash);
    let digest = env::sha256_array(&signed_msg);

    env::p256_verify(&sig, &digest, &compressed_pk)
}

pub fn verify_ed25519_sig(expected_pubkey: &str, payload: &[u8], signature_str: &str) -> bool {
    let Ok(pk) = parse_ed25519_key(expected_pubkey) else {
        return false;
    };
    let Ok(sig) = decode_sig_64(signature_str, "ed25519:") else {
        return false;
    };
    env::ed25519_verify(&sig, payload, &pk)
}

pub fn verify_auth_proof(
    expected_pubkey: &str,
    payload: &[u8],
    proof: &AuthProof,
    allowed_origins: &[String],
) -> bool {
    match proof {
        AuthProof::WebAuthn(wp) => {
            expected_pubkey.starts_with("p256:")
                && verify_webauthn_p256(expected_pubkey, payload, wp, allowed_origins)
        }
        AuthProof::Ed25519 { pubkey, signature } => {
            expected_pubkey.starts_with("ed25519:")
                && pubkey == expected_pubkey
                && verify_ed25519_sig(expected_pubkey, payload, signature)
        }
    }
}

pub fn canonical_circle_agree_payload(
    contract_id: &AccountId,
    circle_id: &str,
    creator_account_id: &AccountId,
    payout_account_id: &AccountId,
    asset: &AssetSpec,
    target_amount: u128,
    members: &[CircleMemberInput],
) -> Vec<u8> {
    let members_encoded: Vec<String> = members
        .iter()
        .map(|m| format!("{}:{}:{}", m.account_id, m.pubkey, m.share_bps))
        .collect();
    format!(
        "{}|circle_agree|{}|{}|{}|{}|{}|{}|{}",
        DOMAIN,
        contract_id,
        circle_id,
        creator_account_id,
        payout_account_id,
        asset.canonical_id(),
        target_amount,
        members_encoded.join(",")
    )
    .into_bytes()
}

pub fn canonical_circle_settle_payload(
    contract_id: &AccountId,
    circle_id: &str,
    payout_account_id: &AccountId,
    total_contributed: u128,
) -> Vec<u8> {
    format!(
        "{}|circle_settle|{}|{}|{}|{}",
        DOMAIN, contract_id, circle_id, payout_account_id, total_contributed
    )
    .into_bytes()
}

pub fn canonical_circle_dissolve_payload(contract_id: &AccountId, circle_id: &str) -> Vec<u8> {
    format!("{}|circle_dissolve|{}|{}", DOMAIN, contract_id, circle_id).into_bytes()
}

pub fn canonical_gift_claim_payload(
    contract_id: &AccountId,
    gift_id: &str,
    recipient_handle_hash: &str,
    recipient_account_id: &AccountId,
    deadline_ms: u64,
) -> Vec<u8> {
    format!(
        "{}|gift_claim|{}|{}|{}|{}|{}",
        DOMAIN, contract_id, gift_id, recipient_handle_hash, recipient_account_id, deadline_ms
    )
    .into_bytes()
}

pub fn canonical_gift_recipient_payload(
    contract_id: &AccountId,
    gift_id: &str,
    recipient_account_id: &AccountId,
) -> Vec<u8> {
    format!(
        "{}|gift_recipient|{}|{}|{}",
        DOMAIN, contract_id, gift_id, recipient_account_id
    )
    .into_bytes()
}

pub fn canonical_gift_reclaim_payload(
    contract_id: &AccountId,
    gift_id: &str,
    sender_account_id: &AccountId,
) -> Vec<u8> {
    format!(
        "{}|gift_reclaim|{}|{}|{}",
        DOMAIN, contract_id, gift_id, sender_account_id
    )
    .into_bytes()
}

pub fn canonical_unclaimed_claim_payload(
    contract_id: &AccountId,
    send_id: &str,
    recipient_handle_hash: &str,
    recipient_account_id: &AccountId,
    deadline_ms: u64,
) -> Vec<u8> {
    format!(
        "{}|unclaimed_claim|{}|{}|{}|{}|{}",
        DOMAIN, contract_id, send_id, recipient_handle_hash, recipient_account_id, deadline_ms
    )
    .into_bytes()
}

pub fn canonical_unclaimed_refund_payload(
    contract_id: &AccountId,
    send_id: &str,
    sender_account_id: &AccountId,
) -> Vec<u8> {
    format!(
        "{}|unclaimed_refund|{}|{}|{}",
        DOMAIN, contract_id, send_id, sender_account_id
    )
    .into_bytes()
}
