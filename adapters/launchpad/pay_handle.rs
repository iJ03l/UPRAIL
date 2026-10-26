//! In-contract payout. Keep the launchpad's own fee receiver.
//! When a payout should reach an X handle, make this call instead of paying
//! that wallet. `token` is the fee token; use `wrap.near` for NEAR, because a
//! native transfer cannot carry a memo. Deposit is exactly 1 yoctoNEAR.
//! Do not use `ft_transfer_call`.
//!
//! After the receipt is final, POST `{ "txHash": "..." }` to `/api/fees/adapter`.

pub fn uprail_fee_memo(handle: &str) -> Result<String, &'static str> {
    let handle = handle.trim().trim_start_matches('@').to_ascii_lowercase();
    let ok = !handle.is_empty()
        && handle.len() <= 15
        && handle
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_');
    if !ok {
        return Err("X handle must be 1-15 letters, numbers, or underscores");
    }
    Ok(format!("Fees to @{handle} via UPRAIL"))
}

/// JSON arguments for `ft_transfer` on `token`.
pub fn uprail_fee_args(handle: &str, amount_atomic: &str) -> Result<String, &'static str> {
    if amount_atomic.is_empty() || !amount_atomic.bytes().all(|byte| byte.is_ascii_digit()) || amount_atomic == "0" {
        return Err("amount must be a positive integer string");
    }
    Ok(format!(
        r#"{{"receiver_id":"escrow.uprail.near","amount":"{amount_atomic}","memo":"{}"}}"#,
        uprail_fee_memo(handle)?
    ))
}
