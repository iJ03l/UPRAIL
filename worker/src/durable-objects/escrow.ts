/**
 * EscrowDO - Durable Object for per-payment escrow lifecycle management
 * SQLite-backed storage, WebAuthn/NEAR claim execution, 30-day auto-refund alarm
 */

import { DurableObject } from 'cloudflare:workers';
import { Env, Payment, PaymentStatus } from '../types';
import * as nearProxy from '../services/nearProxy';

interface EscrowDbRow {
  payment_id: string;
  sender_x_id: string | null;
  sender_x_handle: string | null;
  recipient_handle: string;
  asset: string;
  amount: string;
  status: string;
  deposit_address: string | null;
  intent_hash: string | null;
  claim_tx_hash: string | null;
  refund_tx_hash: string | null;
  created_at: number;
  expires_at: number;
  updated_at: number;
  retry_count: number;
}

export class EscrowDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Initialize local SQLite table inside Durable Object
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS escrow_state (
          payment_id TEXT PRIMARY KEY,
          sender_x_id TEXT,
          sender_x_handle TEXT,
          recipient_handle TEXT NOT NULL,
          asset TEXT NOT NULL,
          amount TEXT NOT NULL,
          status TEXT NOT NULL,
          deposit_address TEXT,
          intent_hash TEXT,
          claim_tx_hash TEXT,
          refund_tx_hash TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0
        )
      `);
    });
  }

  /**
   * Initialize a new payment escrow
   */
  async initPayment(payment: Payment): Promise<Payment> {
    const now = Date.now();
    const expiry = payment.expires_at || now + 30 * 86400 * 1000;

    this.ctx.storage.sql.exec(
      `
      INSERT OR REPLACE INTO escrow_state (
        payment_id,
        sender_x_id,
        sender_x_handle,
        recipient_handle,
        asset,
        amount,
        status,
        deposit_address,
        intent_hash,
        claim_tx_hash,
        refund_tx_hash,
        created_at,
        expires_at,
        updated_at,
        retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `,
      payment.id,
      payment.sender_x_id ?? null,
      payment.sender_x_handle ?? null,
      payment.recipient_handle,
      payment.asset,
      payment.amount,
      payment.status || PaymentStatus.DEPOSIT_WAITING,
      payment.deposit_address ?? null,
      payment.intent_hash ?? null,
      payment.claim_tx_hash ?? null,
      payment.refund_tx_hash ?? null,
      payment.created_at || now,
      expiry,
      now
    );

    // Set alarm for payment expiry (30 days default)
    await this.ctx.storage.setAlarm(expiry);

    const state = this.getState();
    if (state) {
      await this.syncToD1(state);
      return state;
    }
    return payment;
  }

  /**
   * Mark deposit as confirmed by solver relay
   */
  async depositConfirmed(intentHash: string): Promise<Payment> {
    const state = this.getState();
    if (!state) {
      throw new Error('Payment not initialized');
    }

    if (state.status !== PaymentStatus.PENDING && state.status !== PaymentStatus.DEPOSIT_WAITING) {
      throw new Error(`Cannot confirm deposit for payment in status ${state.status}`);
    }

    const updated = await this.updateStatus(PaymentStatus.ESCROWED, {
      intent_hash: intentHash,
    });

    return updated;
  }

  /**
   * Recipient claim execution
   * Calls Go Container to execute confidential NEAR transfer to recipient
   */
  async claim(recipientNearAccount: string): Promise<{ payment: Payment; txHash: string }> {
    const state = this.getState();
    if (!state) {
      throw new Error('Payment escrow not found');
    }

    if (state.status === PaymentStatus.CLAIMED) {
      return { payment: state, txHash: state.claim_tx_hash || '' };
    }

    if (state.status !== PaymentStatus.ESCROWED && state.status !== PaymentStatus.DEPOSIT_WAITING) {
      throw new Error(`Cannot claim payment with status: ${state.status}`);
    }

    // Call Go Container to execute NEAR transfer
    const result = await nearProxy.transfer(this.env, {
      recipientNearAccount,
      asset: state.asset,
      amount: state.amount,
      escrowAccountId: this.env.ESCROW_ACCOUNT_ID,
      intentHash: state.intent_hash,
      paymentId: state.id,
    });

    // Update status to CLAIMED
    const updated = await this.updateStatus(PaymentStatus.CLAIMED, {
      claim_tx_hash: result.txHash,
    });

    // Cancel expiry alarm since funds have been claimed
    await this.ctx.storage.deleteAlarm();

    return {
      payment: updated,
      txHash: result.txHash,
    };
  }

  /**
   * Cancel payment (only possible if PENDING or DEPOSIT_WAITING)
   */
  async cancel(senderXId?: string): Promise<Payment> {
    const state = this.getState();
    if (!state) {
      throw new Error('Payment escrow not found');
    }

    if (!senderXId || (state.sender_x_id && state.sender_x_id !== senderXId)) {
      throw new Error('Forbidden: Only the authenticated sender may cancel this payment');
    }

    if (state.status !== PaymentStatus.PENDING && state.status !== PaymentStatus.DEPOSIT_WAITING) {
      throw new Error(`Cannot cancel payment in status: ${state.status}`);
    }

    const updated = await this.updateStatus(PaymentStatus.CANCELLED);
    await this.ctx.storage.deleteAlarm();
    return updated;
  }

  /**
   * Alarm handler for automatic expiration and refund
   */
  override async alarm(): Promise<void> {
    const state = this.getState();
    if (!state) return;

    // Already settled states do not need refund
    if (
      state.status === PaymentStatus.CLAIMED ||
      state.status === PaymentStatus.REFUNDED ||
      state.status === PaymentStatus.CANCELLED ||
      state.status === PaymentStatus.EXPIRED
    ) {
      return;
    }

    if (state.status === PaymentStatus.ESCROWED) {
      console.log(`[EscrowDO ${state.id}] Alarm triggered: processing refund...`);
      try {
        const result = await nearProxy.refund(this.env, {
          senderNearAccount: state.sender_x_handle ? `${state.sender_x_handle}.uprail.near` : null,
          asset: state.asset,
          amount: state.amount,
          escrowAccountId: this.env.ESCROW_ACCOUNT_ID,
          intentHash: state.intent_hash,
          paymentId: state.id,
        });

        await this.updateStatus(PaymentStatus.REFUNDED, {
          refund_tx_hash: result.txHash,
        });
        console.log(`[EscrowDO ${state.id}] Refund succeeded: ${result.txHash}`);
      } catch (err: any) {
        console.error(`[EscrowDO ${state.id}] Refund attempt failed:`, err);

        // Fetch current retry count
        const row = this.getRawRow();
        const nextRetry = (row?.retry_count || 0) + 1;

        if (nextRetry <= 5) {
          this.ctx.storage.sql.exec(
            `UPDATE escrow_state SET retry_count = ? WHERE payment_id = ?`,
            nextRetry,
            state.id
          );
          // Exponential backoff: 5, 10, 15, 20, 25 minutes
          const retryDelay = nextRetry * 5 * 60 * 1000;
          await this.ctx.storage.setAlarm(Date.now() + retryDelay);
          console.log(`[EscrowDO ${state.id}] Scheduled retry #${nextRetry} in ${retryDelay}ms`);
        } else {
          console.error(`[EscrowDO ${state.id}] Max refund retries reached. Marking EXPIRED.`);
          await this.updateStatus(PaymentStatus.EXPIRED);
        }
      }
    } else {
      // PENDING or DEPOSIT_WAITING expired without deposit
      console.log(`[EscrowDO ${state.id}] Alarm triggered on un-escrowed payment. Marking EXPIRED.`);
      await this.updateStatus(PaymentStatus.EXPIRED);
    }
  }

  /**
   * Retrieve current escrow state
   */
  async getStatus(): Promise<Payment | null> {
    return this.getState();
  }

  /**
   * HTTP handler for fetch-based DO access
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'GET' && path === '/status') {
        const state = await this.getStatus();
        if (!state) {
          return new Response(JSON.stringify({ error: 'Not found', code: 'NOT_FOUND' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST' && path === '/init') {
        const body = (await request.json()) as Payment;
        const result = await this.initPayment(body);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST' && path === '/deposit-confirmed') {
        const { intentHash } = (await request.json()) as { intentHash: string };
        const result = await this.depositConfirmed(intentHash);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST' && path === '/claim') {
        const { recipientNearAccount } = (await request.json()) as {
          recipientNearAccount: string;
        };
        const result = await this.claim(recipientNearAccount);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST' && path === '/cancel') {
        const { senderXId } = ((await request.json().catch(() => ({}))) || {}) as {
          senderXId?: string;
        };
        const result = await this.cancel(senderXId);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not Found', code: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          error: err.message || 'Internal error',
          code: 'ESCROW_ERROR',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // --- Private Helpers ---

  private getRawRow(): EscrowDbRow | null {
    const cursor = this.ctx.storage.sql.exec(`SELECT * FROM escrow_state LIMIT 1`);
    for (const row of cursor) {
      return row as unknown as EscrowDbRow;
    }
    return null;
  }

  private getState(): Payment | null {
    const row = this.getRawRow();
    if (!row) return null;

    return {
      id: row.payment_id,
      sender_x_id: row.sender_x_id,
      sender_x_handle: row.sender_x_handle,
      recipient_handle: row.recipient_handle,
      asset: row.asset,
      amount: row.amount,
      status: row.status as PaymentStatus,
      deposit_address: row.deposit_address,
      intent_hash: row.intent_hash,
      claim_tx_hash: row.claim_tx_hash,
      refund_tx_hash: row.refund_tx_hash,
      created_at: row.created_at,
      expires_at: row.expires_at,
      updated_at: row.updated_at,
    };
  }

  private async updateStatus(
    newStatus: PaymentStatus,
    extra?: {
      intent_hash?: string | null;
      claim_tx_hash?: string | null;
      refund_tx_hash?: string | null;
    }
  ): Promise<Payment> {
    const now = Date.now();
    const current = this.getState();
    if (!current) throw new Error('Payment not found');

    const intentHash = extra?.intent_hash !== undefined ? extra.intent_hash : current.intent_hash;
    const claimTxHash =
      extra?.claim_tx_hash !== undefined ? extra.claim_tx_hash : current.claim_tx_hash;
    const refundTxHash =
      extra?.refund_tx_hash !== undefined ? extra.refund_tx_hash : current.refund_tx_hash;

    this.ctx.storage.sql.exec(
      `
      UPDATE escrow_state
      SET status = ?,
          intent_hash = ?,
          claim_tx_hash = ?,
          refund_tx_hash = ?,
          updated_at = ?
      WHERE payment_id = ?
    `,
      newStatus,
      intentHash ?? null,
      claimTxHash ?? null,
      refundTxHash ?? null,
      now,
      current.id
    );

    const updated = this.getState()!;
    await this.syncToD1(updated);
    return updated;
  }

  private async syncToD1(state: Payment): Promise<void> {
    try {
      await this.env.DB.prepare(
        `
        INSERT INTO payments (
          id,
          sender_x_id,
          sender_x_handle,
          recipient_handle,
          asset,
          amount,
          status,
          deposit_address,
          intent_hash,
          claim_tx_hash,
          refund_tx_hash,
          created_at,
          expires_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          deposit_address = excluded.deposit_address,
          intent_hash = excluded.intent_hash,
          claim_tx_hash = excluded.claim_tx_hash,
          refund_tx_hash = excluded.refund_tx_hash,
          updated_at = excluded.updated_at
      `
      )
        .bind(
          state.id,
          state.sender_x_id ?? null,
          state.sender_x_handle ?? null,
          state.recipient_handle,
          state.asset,
          state.amount,
          state.status,
          state.deposit_address ?? null,
          state.intent_hash ?? null,
          state.claim_tx_hash ?? null,
          state.refund_tx_hash ?? null,
          state.created_at,
          state.expires_at,
          state.updated_at
        )
        .run();
    } catch (err) {
      console.error(`[EscrowDO ${state.id}] Failed to sync state to D1:`, err);
    }
  }
}
