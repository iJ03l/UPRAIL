/**
 * Instant Passkey Authorization for AI Agent Payments (UPRAIL).
 *
 * When an agent payment (single or multi-account) exceeds guardrail spend caps,
 * an approval record is created in `agent_approvals` and an instant auth link is
 * returned: `https://app.uprail.world/approve?id=<approvalId>`.
 *
 * The user signs on their device using Touch ID / Face ID / WebAuthn passkey.
 * Once verified, payments are executed atomically and the share links are returned
 * to the user on-screen and accessible to the AI agent via `check_approval`.
 */

import { Context, Hono } from 'hono';
import type { AppContext, Env, PaymentStatus } from '../types';
import { updateSession } from '../middleware/session';
import { hasRecentPasskey, verifyPasskeyAssertion } from '../middleware/passkeyAuth';
import { resolveOrigin } from '../services/webauthnConfig';
import { publicErrorMessage } from '../utils/errors';
import { handleSendPayment, paymentsRouter } from './payments';

export const approvalRouter = new Hono<AppContext>();

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)} — UPRAIL</title>
<style>
:root{color-scheme:dark;--bg:#0c0a09;--panel:#171412;--line:#2b2521;--text:#f5f5f4;--muted:#a8a29e;--accent:#e05326}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 600px at 50% -10%,#2a1610 0%,var(--bg) 55%);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:100%;max-width:540px;background:linear-gradient(180deg,#1c1917,#141210);border:1px solid var(--line);border-radius:24px;padding:32px;box-shadow:0 30px 80px -30px #000}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;font-size:11px;color:var(--muted);margin-bottom:20px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 18px var(--accent)}
h1{font-size:26px;line-height:1.2;letter-spacing:-.03em;margin:0 0 8px}
p{margin:0 0 16px;color:var(--muted)}
.agent-tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;padding:5px 10px;border-radius:999px;background:#2a1a12;border:1px solid #4a2a1b;color:#f0a07e;margin-bottom:16px}
.summary-box{display:flex;align-items:baseline;justify-content:space-between;padding:16px;border:1px solid var(--line);border-radius:16px;background:#0f0d0c;margin:18px 0}
.summary-amount{font-size:26px;font-weight:800;letter-spacing:-.02em;color:var(--text)}
.summary-usd{font-size:14px;color:var(--muted);font-weight:600}
.notice{border:1px solid #4a2a1b;background:#23140e;color:#fdba74;border-radius:13px;padding:12px 14px;font-size:13px;margin:16px 0;line-height:1.45}
.recipients{border:1px solid var(--line);border-radius:16px;overflow:hidden;margin:18px 0;background:#0f0d0c}
.recipient-row{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)}
.recipient-row:last-child{border-bottom:0}
.recipient-name{font-weight:700;color:var(--text);font-size:14px}
.recipient-amount{font-weight:700;color:#d6d3d1;font-size:14px}
.actions{display:flex;gap:10px;margin-top:24px}
button,.btn{font:inherit;font-weight:800;border-radius:14px;padding:13px 18px;border:1px solid transparent;cursor:pointer;text-align:center;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.approve{flex:1;background:var(--text);color:#0c0a09}
.deny{background:transparent;color:var(--muted);border-color:var(--line)}
.btn-tweet{background:#1d9bf0;color:#fff;font-size:12px;padding:8px 14px;border-radius:10px}
.btn-copy{background:#292524;color:#d6d3d1;font-size:12px;padding:8px 14px;border-radius:10px;border:1px solid var(--line)}
button:disabled{opacity:.55;cursor:wait}
.error{border:1px solid #5b1f1f;background:#2a1111;color:#fca5a5;border-radius:13px;padding:12px 14px;font-size:13px;margin:16px 0;display:none}
.success-card{background:#111b15;border:1px solid #1c3826;color:#86efac;border-radius:16px;padding:16px;margin:16px 0}
.links-list{display:grid;gap:12px;margin:16px 0}
.link-item{background:#0f0d0c;border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
.link-url{font-family:monospace;font-size:11px;color:#a8a29e;word-break:break-all;background:#171412;padding:8px 10px;border-radius:8px;border:1px solid #2b2521}
.link-actions{display:flex;gap:8px}
.foot{font-size:11px;color:#57534e;margin:20px 0 0;line-height:1.5}
@media(max-width:480px){.card{padding:22px}h1{font-size:22px}}
</style>
</head>
<body><main class="card">${body}</main></body>
</html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}

function errorScreen(title: string, message: string, status = 400): Response {
  return page(
    title,
    `<div class="brand"><span class="dot"></span>UPRAIL</div>
     <h1>${escapeHtml(title)}</h1>
     <p>${escapeHtml(message)}</p>
     <p class="foot">Return to your AI app or UPRAIL dashboard.</p>`,
    status
  );
}

interface ApprovalPayload {
  asset: string;
  recipients: Array<{ recipientHandle: string; amount: string; usd?: number | null }>;
  totalAmount: string;
  totalUsd: number;
  memo?: string;
  agentName: string;
  exceededReason?: string;
  limitUsd?: number;
}

approvalRouter.get('/approve', handleGetApproval);
approvalRouter.get('/app/approve', handleGetApproval);

async function handleGetApproval(c: Context<AppContext>): Promise<Response> {
  const approvalId = String(c.req.query('id') || '').trim();
  if (!approvalId) {
    return errorScreen('Invalid Request', 'Missing approval ID parameter.');
  }

  const row = await c.env.DB.prepare(
    'SELECT id, x_id, agent_key_id, payload, status, result, created_at, expires_at FROM agent_approvals WHERE id = ?'
  )
    .bind(approvalId)
    .first<any>();

  if (!row) {
    return errorScreen('Not Found', 'This payment approval request does not exist or has already been pruned.', 404);
  }

  if (row.status === 'EXPIRED' || (row.status === 'PENDING' && row.expires_at < Date.now())) {
    return errorScreen('Approval Expired', 'This payment authorization request expired. Please have your AI agent request a new send.', 410);
  }

  if (row.status === 'DENIED') {
    return page(
      'Payment Request Denied',
      `<div class="brand"><span class="dot"></span>UPRAIL</div>
       <h1>Request Denied</h1>
       <p>This payment authorization request was rejected. No funds were moved from your vault.</p>
       <p class="foot">Return to your AI chat app.</p>`
    );
  }

  let payload: ApprovalPayload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return errorScreen('Malformed Request', 'The payment request payload was corrupted.');
  }

  if (row.status === 'APPROVED' && row.result) {
    let resultData: any = {};
    try {
      resultData = JSON.parse(row.result);
    } catch {}
    const payments: any[] = resultData.payments || [];
    return renderSuccessScreen(payload, payments);
  }

  const session = c.get('session');
  const requestUrl = new URL(c.req.url);
  if (!session) {
    const returnTo = encodeURIComponent(`${requestUrl.pathname}${requestUrl.search}`);
    return c.redirect(`/auth/x/login?return_to=${returnTo}`, 302);
  }

  if (session.x_id !== row.x_id) {
    return errorScreen('Unauthorized', 'This payment authorization request belongs to a different UPRAIL account.', 403);
  }

  const recentPasskey = hasRecentPasskey(session);
  const recipientCount = payload.recipients.length;
  const isMultiple = recipientCount > 1;

  const script = recentPasskey
    ? `const form=document.getElementById('approval-form');const approve=document.getElementById('approve');approve.addEventListener('click',()=>{approve.disabled=true;form.submit()});`
    : `
function b64urlToBuf(value){
  let s=String(value).replace(/-/g,'+').replace(/_/g,'/');
  while(s.length%4)s+='=';
  const bin=atob(s);const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out.buffer;
}
function bufToB64url(buf){
  const bytes=new Uint8Array(buf);let bin='';
  for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
}
function serialize(cred){
  const r=cred.response;
  return {
    id:cred.id,
    rawId:bufToB64url(cred.rawId),
    type:cred.type,
    response:{
      clientDataJSON:bufToB64url(r.clientDataJSON),
      authenticatorData:bufToB64url(r.authenticatorData),
      signature:bufToB64url(r.signature),
      userHandle:r.userHandle?bufToB64url(r.userHandle):undefined
    },
    clientExtensionResults:cred.getClientExtensionResults()
  };
}
const form=document.getElementById('approval-form');
const err=document.getElementById('error');
const approve=document.getElementById('approve');
const assertion=document.getElementById('passkeyAssertion');
approve.addEventListener('click',async()=>{
  approve.disabled=true;err.style.display='none';
  try{
    const res=await fetch('/api/auth-challenge',{credentials:'include',headers:{accept:'application/json'}});
    if(!res.ok)throw new Error('Could not start passkey authorization. Please sign in again.');
    const options=await res.json();
    const cred=await navigator.credentials.get({publicKey:{
      challenge:b64urlToBuf(options.challenge),
      rpId:options.rpId,
      timeout:options.timeout||60000,
      userVerification:'preferred'
    }});
    if(!cred)throw new Error('Passkey confirmation was cancelled.');
    assertion.value=JSON.stringify(serialize(cred));
    form.submit();
  }catch(e){
    err.textContent=e&&e.message?e.message:'Passkey confirmation failed.';
    err.style.display='block';
    approve.disabled=false;
  }
});`;

  const recipientsHtml = payload.recipients
    .map(
      (r) =>
        `<div class="recipient-row">
          <span class="recipient-name">@${escapeHtml(r.recipientHandle.replace(/^@+/, ''))}</span>
          <span class="recipient-amount">${escapeHtml(r.amount)} ${escapeHtml(payload.asset)}</span>
        </div>`
    )
    .join('');

  return page(
    'Authorize AI Payment',
    `<div class="brand"><span class="dot"></span>UPRAIL</div>
     <div class="agent-tag">🤖 ${escapeHtml(payload.agentName || 'AI Agent')}</div>
     <h1>Authorize ${isMultiple ? `${recipientCount} Payments` : 'Payment'}</h1>
     <p>${escapeHtml(payload.agentName || 'AI Agent')} requested a confidential payment that exceeds your guardrail limit.</p>
     
     <div class="summary-box">
       <div>
         <span style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700">Total Payment</span>
         <div class="summary-amount">${escapeHtml(payload.totalAmount)} ${escapeHtml(payload.asset)}</div>
       </div>
       <div class="summary-usd">~$${escapeHtml(payload.totalUsd.toFixed(2))} USD</div>
     </div>

     <div class="notice">
       ⚠️ This payment exceeds your ${payload.exceededReason === 'daily_limit' ? 'daily limit' : 'per-payment limit'}${typeof payload.limitUsd === 'number' ? ` ($${payload.limitUsd.toFixed(2)})` : ''}. Confirming with your Passkey will authorize and execute the transfer immediately.
     </div>

     <label>Recipient${isMultiple ? 's' : ''}</label>
     <div class="recipients">${recipientsHtml}</div>
     ${payload.memo ? `<p style="font-size:13px;color:#a8a29e"><strong>Memo:</strong> ${escapeHtml(payload.memo)}</p>` : ''}

     <div class="error" id="error"></div>

     <form id="approval-form" method="post" action="/approve/submit">
       <input type="hidden" name="id" value="${escapeHtml(approvalId)}">
       <input type="hidden" name="passkeyAssertion" id="passkeyAssertion" value="">
       <div class="actions">
         <button class="approve" id="approve" type="button">${recentPasskey ? 'Approve & Send' : 'Confirm with Face ID / Touch ID'}</button>
         <button class="deny" type="submit" formaction="/approve/deny" formnovalidate>Reject</button>
       </div>
     </form>
     <p class="foot">Authorized using WebAuthn Passkeys. Funds are transferred from your UPRAIL vault.</p>
     <script>${script}</script>`
  );
}

approvalRouter.post('/approve/submit', async (c) => {
  const session = c.get('session');
  if (!session) {
    return errorScreen('Session Expired', 'Your session expired. Please sign in again to approve.', 401);
  }

  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return errorScreen('Invalid Request', 'Failed to read approval form submission.');
  }

  const approvalId = String(form.get('id') || '').trim();
  if (!approvalId) return errorScreen('Invalid Request', 'Missing approval ID.');

  const row = await c.env.DB.prepare(
    'SELECT id, x_id, agent_key_id, payload, status, created_at, expires_at FROM agent_approvals WHERE id = ?'
  )
    .bind(approvalId)
    .first<any>();

  if (!row) {
    return errorScreen('Not Found', 'Approval request not found.', 404);
  }

  if (row.x_id !== session.x_id) {
    return errorScreen('Unauthorized', 'This payment authorization request belongs to another account.', 403);
  }

  if (row.status !== 'PENDING') {
    return errorScreen('Already Processed', `This payment request has already been ${row.status.toLowerCase()}.`, 409);
  }

  if (row.expires_at < Date.now()) {
    return errorScreen('Expired', 'This approval request has expired.', 410);
  }

  // 1. Passkey Verification
  if (!hasRecentPasskey(session)) {
    const rawAssertion = String(form.get('passkeyAssertion') || '');
    if (!rawAssertion) {
      return errorScreen('Passkey Required', 'Please confirm with Face ID or Touch ID to authorize this payment.', 403);
    }
    let assertion: any;
    try {
      assertion = JSON.parse(rawAssertion);
    } catch {
      return errorScreen('Malformed Passkey', 'Passkey confirmation data was malformed.', 400);
    }
    const verified = await verifyPasskeyAssertion(c.env, session.x_id, assertion);
    if (!verified.ok) return errorScreen('Passkey Verification Failed', verified.message, verified.status);
    await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
  }

  // 2. Atomically lock row in IN_PROGRESS
  const lock = await c.env.DB.prepare(
    "UPDATE agent_approvals SET status = 'IN_PROGRESS', decided_at = ? WHERE id = ? AND status = 'PENDING'"
  )
    .bind(Date.now(), approvalId)
    .run();

  if ((lock.meta?.changes ?? 0) === 0) {
    return errorScreen('Conflict', 'This approval was already processed or expired.', 409);
  }

  // 3. Parse and execute payments
  let payload: ApprovalPayload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return errorScreen('Error', 'Malformed approval payload.');
  }

  const executedPayments: any[] = [];
  try {
    for (const r of payload.recipients) {
      const recipientHandle = r.recipientHandle.replace(/^@+/, '');
      const rawAmount = r.amount;

      // Obtain quote
      const quoteReq = new Request('https://uprail.internal/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientHandle, asset: payload.asset, amount: rawAmount }),
      });
      const quoteRes = await paymentsRouter.fetch(quoteReq, c.env, c.executionCtx);
      if (!quoteRes.ok) {
        throw new Error(`Failed to quote payment to @${recipientHandle}`);
      }
      const quote = (await quoteRes.json()) as any;

      // Mount parsedBody
      c.set('parsedBody' as any, {
        recipientHandle,
        asset: payload.asset,
        amount: rawAmount,
        memo: payload.memo,
        quoteSignature: quote.quoteSignature,
        depositAddress: quote.depositAddress,
      });

      // Execute human send payment
      const sendRes = await handleSendPayment(c);
      if (sendRes.status !== 201) {
        const errJson = (await sendRes.json().catch(() => ({}))) as any;
        throw new Error(errJson.error || `Failed to deliver payment to @${recipientHandle}`);
      }
      const sendData = (await sendRes.json()) as any;
      executedPayments.push({
        recipientHandle,
        amount: rawAmount,
        asset: payload.asset,
        paymentId: sendData.paymentId,
        shareLink: sendData.shareLink,
        claimLink: sendData.claimLink || sendData.shareLink,
        xShareUrl: sendData.xShareUrl,
        tweetIntentUrl: sendData.tweetIntentUrl,
        status: sendData.status,
      });
    }

    // 4. Update approval record to APPROVED with results
    const resultObj = {
      payments: executedPayments,
      shareLinks: executedPayments.map((p) => p.shareLink).filter(Boolean),
    };

    await c.env.DB.prepare(
      "UPDATE agent_approvals SET status = 'APPROVED', result = ?, decided_at = ? WHERE id = ?"
    )
      .bind(JSON.stringify(resultObj), Date.now(), approvalId)
      .run();

    return renderSuccessScreen(payload, executedPayments);
  } catch (err: any) {
    console.error('[approval] payment execution failed:', err);
    // Mark as failed/pending for retry
    await c.env.DB.prepare(
      "UPDATE agent_approvals SET status = 'FAILED', result = ? WHERE id = ?"
    )
      .bind(JSON.stringify({ error: err.message || String(err) }), approvalId)
      .run();

    return errorScreen(
      'Settlement Error',
      `Payment execution failed: ${err.message || 'Unknown error'}. Any already-delivered payments remain valid.`
    );
  }
});

approvalRouter.post('/approve/deny', async (c) => {
  const session = c.get('session');
  if (!session) return errorScreen('Session Expired', 'Sign in to reject this request.', 401);

  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return errorScreen('Invalid Request', 'Form parse error.');
  }

  const approvalId = String(form.get('id') || '').trim();
  if (approvalId) {
    await c.env.DB.prepare(
      "UPDATE agent_approvals SET status = 'DENIED', decided_at = ? WHERE id = ? AND x_id = ?"
    )
      .bind(Date.now(), approvalId, session.x_id)
      .run();
  }

  return page(
    'Payment Request Denied',
    `<div class="brand"><span class="dot"></span>UPRAIL</div>
     <h1>Payment Denied</h1>
     <p>You rejected this payment request. No funds left your account.</p>
     <p class="foot">Return to your AI app or close this page.</p>`
  );
});

// JSON API for agents to poll status of an approval request
approvalRouter.get('/api/agent/approval/:id', async (c) => {
  const approvalId = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT id, x_id, agent_key_id, payload, status, result, created_at, expires_at, decided_at FROM agent_approvals WHERE id = ?'
  )
    .bind(approvalId)
    .first<any>();

  if (!row) return c.json({ error: 'Approval request not found.', code: 'NOT_FOUND' }, 404);

  let resultData: any = null;
  if (row.result) {
    try {
      resultData = JSON.parse(row.result);
    } catch {}
  }

  const appOrigin = resolveOrigin(c.env);
  return c.json({
    id: row.id,
    status: row.status,
    approvalUrl: `${appOrigin}/approve?id=${row.id}`,
    expiresAt: row.expires_at,
    isExpired: row.expires_at < Date.now(),
    decidedAt: row.decided_at,
    result: resultData,
  });
});

function renderSuccessScreen(payload: ApprovalPayload, payments: any[]): Response {
  const linksHtml = payments
    .map((p) => {
      const handle = p.recipientHandle.replace(/^@+/, '');
      const shareUrl = p.shareLink || p.claimLink;
      const xUrl = p.xShareUrl || (shareUrl ? `https://x.com/intent/post?text=${encodeURIComponent(`Hey @${handle}, I sent you ${p.amount} ${p.asset} on UPRAIL: ${shareUrl}`)}` : '');
      return `
      <div class="link-item">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong style="color:var(--text);font-size:14px">@${escapeHtml(handle)}</strong>
          <span style="color:#86efac;font-weight:700;font-size:13px">${escapeHtml(p.amount)} ${escapeHtml(p.asset)}</span>
        </div>
        <div class="link-url">${escapeHtml(shareUrl)}</div>
        <div class="link-actions">
          <button class="btn btn-copy" type="button" onclick="navigator.clipboard.writeText('${escapeHtml(shareUrl)}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy Link',2000)">Copy Link</button>
          ${xUrl ? `<a class="btn btn-tweet" href="${escapeHtml(xUrl)}" target="_blank" rel="noopener noreferrer">Post on X</a>` : ''}
        </div>
      </div>`;
    })
    .join('');

  return page(
    'Payment Authorized & Sent',
    `<div class="brand"><span class="dot"></span>UPRAIL</div>
     <div class="success-card">
       <strong style="display:block;font-size:16px;margin-bottom:4px">✓ Payment Authorized & Delivered</strong>
       <span style="font-size:13px;opacity:.9">Your passkey signed the transfer. Funds have left your vault.</span>
     </div>
     <h1>Share Claim Links</h1>
     <p>Share these links with each recipient on X so they can claim or view the confidential receipt:</p>
     <div class="links-list">${linksHtml}</div>
     <p class="foot">Your AI agent can also read these confirmed links via UPRAIL MCP.</p>`
  );
}
