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
<meta name="theme-color" content="#0A0807">
<title>${escapeHtml(title)} — UPRAIL</title>
<link rel="preconnect" href="https://api.fontshare.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=clash-display@600,700&f[]=cabinet-grotesk@500,700,800,900&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  color-scheme: dark;
  --bg: #0A0807;
  --elevated: #120E0C;
  --chassis: rgba(24, 19, 16, 0.9);
  --line: rgba(44, 34, 29, 0.9);
  --line-highlight: rgba(224, 83, 38, 0.45);
  --text: #F5F2EF;
  --muted: #A8A29E;
  --subtle: #78716C;
  --accent: #E05326;
  --flame: #FF5722;
  --near-green: #00EC97;
  --near-cyan: #00C1DE;
  --font-display: "Clash Display", "Syne", -apple-system, sans-serif;
  --font-sans: "Cabinet Grotesk", "Space Grotesk", -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background-color: var(--bg);
  background-image: 
    radial-gradient(1000px 520px at 50% -10%, rgba(224, 83, 38, 0.22) 0%, rgba(255, 87, 34, 0.08) 35%, transparent 75%),
    radial-gradient(rgba(224, 83, 38, 0.1) 1px, transparent 1px);
  background-size: 100% 100%, 24px 24px;
  color: var(--text);
  font: 15px/1.55 var(--font-sans);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  -webkit-font-smoothing: antialiased;
}
.card {
  width: 100%;
  max-width: 550px;
  background: linear-gradient(180deg, rgba(28, 22, 19, 0.88) 0%, rgba(18, 14, 12, 0.96) 100%);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  border: 1px solid var(--line);
  border-top: 1px solid var(--line-highlight);
  border-radius: 28px;
  padding: 34px;
  box-shadow: 0 35px 90px -25px #000, 0 0 50px -10px rgba(224, 83, 38, 0.15);
  position: relative;
  overflow: hidden;
}
.card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 20%;
  right: 20%;
  height: 1px;
  background: linear-gradient(90deg, transparent, #FF5722, transparent);
  opacity: 0.9;
}
.brand-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}
.brand-icon-wrap {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #181310;
  border: 1px solid rgba(224, 83, 38, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 16px rgba(224, 83, 38, 0.35);
  overflow: hidden;
}
.brand-icon-wrap img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
.brand-name {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text);
  text-transform: uppercase;
}
.protocol-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 236, 151, 0.08);
  border: 1px solid rgba(0, 236, 151, 0.25);
  color: #00EC97;
}
.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00EC97;
  box-shadow: 0 0 8px #00EC97;
  animation: pulse 2s infinite ease-in-out;
}
@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.85); } }

h1 {
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1.18;
  letter-spacing: -0.03em;
  margin: 12px 0 8px;
  color: var(--text);
  font-weight: 700;
}
p {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.5;
}
.agent-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 4px 10px;
  border-radius: 999px;
  background: #2a1a12;
  border: 1px solid #4a2a1b;
  color: #f0a07e;
  margin-bottom: 8px;
}
.summary-box {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(14, 11, 9, 0.85);
  margin: 18px 0;
}
.summary-amount {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}
.summary-usd {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--muted);
  font-weight: 700;
}
.notice {
  border: 1px solid #4a2a1b;
  background: #23140e;
  color: #fdba74;
  border-radius: 14px;
  padding: 12px 14px;
  font-size: 12.5px;
  margin: 16px 0;
  line-height: 1.45;
}
.recipients {
  border: 1px solid var(--line);
  border-radius: 18px;
  overflow: hidden;
  margin: 16px 0;
  background: rgba(14, 11, 9, 0.7);
}
.recipient-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}
.recipient-row:last-child { border-bottom: 0; }
.recipient-name {
  font-weight: 700;
  color: var(--text);
  font-size: 14px;
}
.recipient-amount {
  font-family: var(--font-mono);
  font-weight: 700;
  color: #d6d3d1;
  font-size: 13.5px;
}
.actions {
  display: flex;
  gap: 12px;
  margin-top: 22px;
}
button, .btn {
  font: inherit;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 14px;
  border-radius: 16px;
  padding: 14px 20px;
  border: 1px solid transparent;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.approve {
  flex: 1;
  background: linear-gradient(135deg, #E05326 0%, #FF5722 100%);
  color: #FFFFFF;
  box-shadow: 0 0 28px -4px rgba(224, 83, 38, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.approve:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
  box-shadow: 0 0 36px -2px rgba(224, 83, 38, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.deny {
  background: rgba(28, 22, 19, 0.7);
  color: var(--muted);
  border: 1px solid var(--line);
}
.deny:hover {
  background: rgba(38, 30, 26, 0.9);
  color: var(--text);
  border-color: rgba(64, 50, 44, 0.9);
}
.btn-tweet {
  background: #1d9bf0;
  color: #fff;
  font-size: 12px;
  padding: 9px 15px;
  border-radius: 12px;
}
.btn-copy {
  background: #231b16;
  color: #d6d3d1;
  font-size: 12px;
  padding: 9px 15px;
  border-radius: 12px;
  border: 1px solid var(--line);
}
button:disabled {
  opacity: 0.6;
  cursor: wait;
}
.error {
  border: 1px solid #5b1f1f;
  background: #2a1111;
  color: #fca5a5;
  border-radius: 14px;
  padding: 12px 14px;
  font-size: 12.5px;
  margin: 14px 0;
  display: none;
}
.success-card {
  background: rgba(17, 27, 21, 0.85);
  border: 1px solid rgba(28, 56, 38, 0.9);
  color: #86efac;
  border-radius: 18px;
  padding: 16px 18px;
  margin: 16px 0;
}
.links-list {
  display: grid;
  gap: 12px;
  margin: 18px 0;
}
.link-item {
  background: rgba(14, 11, 9, 0.85);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.link-url {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #a8a29e;
  word-break: break-all;
  background: #171412;
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid #2b2521;
}
.link-actions { display: flex; gap: 8px; }
.foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 11px;
  color: var(--subtle);
  margin: 20px 0 0;
  text-align: center;
  font-family: var(--font-sans);
}
.foot svg { width: 13px; height: 13px; fill: currentColor; opacity: 0.7; }
@media(max-width:480px){
  .card { padding: 22px 18px; }
  h1 { font-size: 22px; }
}
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
    `<div class="brand-bar">
       <div class="brand">
         <div class="brand-icon-wrap"><img src="/brand/uprail-icon.png" alt="UPRAIL"></div>
         <span class="brand-name">UPRAIL</span>
       </div>
       <div class="protocol-badge"><span class="pulse-dot"></span><span>NEAR INTENTS</span></div>
     </div>
     <h1>${escapeHtml(title)}</h1>
     <p>${escapeHtml(message)}</p>
     <div class="actions">
       <a href="https://app.uprail.world" class="btn approve" style="text-decoration:none;width:100%">Return to Dashboard</a>
     </div>
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
    `<div class="brand-bar">
       <div class="brand">
         <div class="brand-icon-wrap"><img src="/brand/uprail-icon.png" alt="UPRAIL"></div>
         <span class="brand-name">UPRAIL</span>
       </div>
       <div class="protocol-badge"><span class="pulse-dot"></span><span>NEAR INTENTS</span></div>
     </div>
     
     <div class="agent-tag">🤖 ${escapeHtml(payload.agentName || 'AI Agent')}</div>
     <h1>Authorize ${isMultiple ? `${recipientCount} Payments` : 'Payment'}</h1>
     <p>${escapeHtml(payload.agentName || 'AI Agent')} requested a confidential payment that exceeds your guardrail limit.</p>
     
     <div class="summary-box">
       <div>
         <span style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;font-family:var(--font-mono)">Total Payment</span>
         <div class="summary-amount">${escapeHtml(payload.totalAmount)} ${escapeHtml(payload.asset)}</div>
       </div>
       <div class="summary-usd">~$${escapeHtml(payload.totalUsd.toFixed(2))} USD</div>
     </div>

     <div class="notice">
       ⚠️ This payment exceeds your ${payload.exceededReason === 'daily_limit' ? 'daily limit' : 'per-payment limit'}${typeof payload.limitUsd === 'number' ? ` ($${payload.limitUsd.toFixed(2)})` : ''}. Confirming with your Passkey will authorize and execute the transfer immediately.
     </div>

     <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-family:var(--font-mono);font-weight:700;margin-bottom:6px">Recipient${isMultiple ? 's' : ''}</label>
     <div class="recipients">${recipientsHtml}</div>
     ${payload.memo ? `<p style="font-size:13px;color:#a8a29e;margin:12px 0"><strong>Memo:</strong> ${escapeHtml(payload.memo)}</p>` : ''}

     <div class="error" id="error"></div>

     <form id="approval-form" method="post" action="/approve/submit">
       <input type="hidden" name="id" value="${escapeHtml(approvalId)}">
       <input type="hidden" name="passkeyAssertion" id="passkeyAssertion" value="">
       <div class="actions">
         <button class="approve" id="approve" type="button">
           <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 0-10 10c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z"/></svg>
           <span>${recentPasskey ? 'Approve & Send' : 'Confirm with Passkey (Touch / Face ID)'}</span>
         </button>
         <button class="deny" type="submit" formaction="/approve/deny" formnovalidate>Reject</button>
       </div>
     </form>
     <div class="foot">
       <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
       <span>Authorized using WebAuthn Passkeys · Funds transferred from UPRAIL vault</span>
     </div>
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
    `<div class="brand-bar">
       <div class="brand">
         <div class="brand-icon-wrap"><img src="/brand/uprail-icon.png" alt="UPRAIL"></div>
         <span class="brand-name">UPRAIL</span>
       </div>
       <div class="protocol-badge"><span class="pulse-dot"></span><span>CONFIRMED</span></div>
     </div>
     <div class="success-card">
       <strong style="display:block;font-size:15px;margin-bottom:4px;font-family:var(--font-display)">✓ Payment Authorized & Settled</strong>
       <span style="font-size:12.5px;opacity:.9">Your passkey signed the transfer. Funds have left your vault.</span>
     </div>
     <h1>Share Claim Links</h1>
     <p>Share these links with each recipient on X so they can claim or view the confidential receipt:</p>
     <div class="links-list">${linksHtml}</div>
     <div class="foot">
       <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
       <span>Your AI agent can also read these confirmed links via UPRAIL MCP.</span>
     </div>`
  );
}
