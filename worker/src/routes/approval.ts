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
import * as nearRpc from '../services/nearRpc';
import { submitOneClickWebAuthnSession } from '../services/custodyService';
import { prepareSelfCustodySend, submitSelfCustodySend } from '../services/selfCustodyActions';
import { handleCustodyActionError } from '../utils/custodyResponse';

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
<meta name="theme-color" content="#f7f5f0">
<title>${escapeHtml(title)} — UPRAIL</title>
<link rel="preconnect" href="https://api.fontshare.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=clash-display@600,700&f[]=cabinet-grotesk@500,700,800&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #f7f5f0;
  --card: #ffffff;
  --line: #e7e5e4;
  --line-strong: #d6d3d1;
  --fg: #1c1917;
  --muted: #78716c;
  --subtle: #a8a29e;
  --accent: #e05326;
  --font-display: "Clash Display", "Syne", -apple-system, sans-serif;
  --font-sans: "Cabinet Grotesk", "Space Grotesk", -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background-color: var(--bg);
  color: var(--fg);
  font: 14px/1.5 var(--font-sans);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  -webkit-font-smoothing: antialiased;
}
.card {
  width: 100%;
  max-width: 440px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 24px;
  padding: 28px 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 8px 20px -6px rgba(0, 0, 0, 0.04);
}
.brand-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}
.brand img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}
.brand-name {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--fg);
  text-transform: uppercase;
}
.badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f5f5f4;
  border: 1px solid var(--line);
  color: var(--muted);
}
h1 {
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 6px;
  color: var(--fg);
}
p.desc {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}
.agent-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 8px;
  border-radius: 999px;
  background: #f5f5f4;
  border: 1px solid var(--line);
  color: var(--muted);
  margin-bottom: 12px;
}
.summary-box {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  background: #fafaf9;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.summary-amount {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  color: var(--fg);
  letter-spacing: -0.02em;
}
.summary-usd {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--muted);
  font-weight: 700;
}
.notice {
  border: 1px solid #fed7aa;
  background: #fff7ed;
  color: #9a3412;
  border-radius: 12px;
  padding: 9px 12px;
  font-size: 11.5px;
  margin: 12px 0;
  line-height: 1.4;
}
.recipients-label {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin: 12px 0 6px;
}
.recipients {
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  background: #fafaf9;
  margin-bottom: 12px;
}
.recipient-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
}
.recipient-row:last-child {
  border-bottom: 0;
}
.recipient-name {
  font-weight: 700;
  color: var(--fg);
}
.recipient-amount {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--fg);
}
.memo-box {
  background: #fafaf9;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 9px 12px;
  font-size: 11.5px;
  color: var(--muted);
  margin-bottom: 12px;
  line-height: 1.4;
}
.memo-box strong {
  color: var(--fg);
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
button, .btn {
  font: inherit;
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border-radius: 14px;
  padding: 12px 16px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s ease;
  text-decoration: none;
}
.approve {
  flex: 1;
  background: #000000;
  color: #ffffff;
  border: 1px solid #000000;
}
.approve:hover {
  background: #292524;
  border-color: #292524;
}
.deny {
  background: #ffffff;
  color: var(--muted);
  border: 1px solid var(--line);
}
.deny:hover {
  color: var(--fg);
  border-color: var(--line-strong);
  background: #fafaf9;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.error {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 11.5px;
  margin: 12px 0;
  display: none;
}
.success-card {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 16px;
  font-size: 12px;
  line-height: 1.4;
}
.success-card strong {
  display: block;
  font-size: 13.5px;
  font-weight: 700;
  margin-bottom: 2px;
}
.links-list {
  display: grid;
  gap: 10px;
  margin: 14px 0;
}
.link-item {
  background: #fafaf9;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.link-url {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  background: #ffffff;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  word-break: break-all;
}
.link-actions {
  display: flex;
  gap: 8px;
}
.btn-copy {
  background: #ffffff;
  color: var(--fg);
  border: 1px solid var(--line);
  font-size: 11px;
  padding: 8px 12px;
  border-radius: 10px;
}
.btn-copy:hover {
  border-color: var(--line-strong);
  background: #fafaf9;
}
.btn-tweet {
  background: #000000;
  color: #ffffff;
  border: 1px solid #000000;
  font-size: 11px;
  padding: 8px 12px;
  border-radius: 10px;
}
.btn-tweet:hover {
  background: #292524;
}
.foot {
  font-size: 10.5px;
  color: var(--subtle);
  margin: 16px 0 0;
  text-align: center;
  line-height: 1.4;
}
@media (max-width: 480px) {
  .card { padding: 22px 18px; border-radius: 20px; }
  h1 { font-size: 19px; }
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
         <img src="/brand/uprail-icon.png" alt="UPRAIL">
         <span class="brand-name">UPRAIL</span>
       </div>
       <span class="badge">ERROR</span>
     </div>
     <h1>${escapeHtml(title)}</h1>
     <p class="desc">${escapeHtml(message)}</p>
     <div class="actions">
       <a href="https://app.uprail.world" class="btn approve" style="width:100%">Return to App</a>
     </div>
     <div class="foot">Return to your AI app or UPRAIL dashboard.</div>`,
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
      `<div class="brand-bar">
         <div class="brand">
           <img src="/brand/uprail-icon.png" alt="UPRAIL">
           <span class="brand-name">UPRAIL</span>
         </div>
         <span class="badge">DENIED</span>
       </div>
       <h1>Request Denied</h1>
       <p class="desc">This payment authorization request was rejected. No funds were moved from your vault.</p>
       <div class="actions">
         <a href="https://app.uprail.world" class="btn approve" style="width:100%">Return to App</a>
       </div>
       <div class="foot">Return to your AI app or close this page.</div>`
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

  const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
  const isSelfCustody = custody?.custodyMode === 'self';
  const recentPasskey = isSelfCustody ? false : hasRecentPasskey(session);
  const recipientCount = payload.recipients.length;
  const isMultiple = recipientCount > 1;

  const selfCustodyScript = `
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
function toPublicKeyOptions(options){
  const pk={
    challenge:b64urlToBuf(options.challenge),
    rpId:options.rpId,
    timeout:options.timeout||60000,
    userVerification:options.userVerification||'required'
  };
  if(Array.isArray(options.allowCredentials)&&options.allowCredentials.length){
    pk.allowCredentials=options.allowCredentials.map(c=>({
      type:c.type||'public-key',
      id:b64urlToBuf(c.id),
      transports:Array.isArray(c.transports)?c.transports:undefined
    }));
  }
  return pk;
}
const err=document.getElementById('error');
const approve=document.getElementById('approve');
const statusEl=document.getElementById('self-status');
const approvalId=${JSON.stringify(approvalId)};
approve.addEventListener('click',async()=>{
  approve.disabled=true;
  err.style.display='none';
  try{
    while(true){
      if(statusEl)statusEl.textContent='Preparing on-chain authorization...';
      const prepRes=await fetch('/api/agent/approval/'+encodeURIComponent(approvalId)+'/prepare',{
        method:'POST',
        credentials:'include',
        headers:{'content-type':'application/json',accept:'application/json'},
        body:'{}'
      });
      const prep=await prepRes.json().catch(()=>({}));
      if(prep&&prep.done){
        window.location.reload();
        return;
      }
      let step=prep&&prep.step?prep.step:undefined;
      if(prepRes.status===409&&prep&&prep.code==='ONECLICK_AUTH_REQUIRED'&&prep.actionId&&prep.options){
        step='oneclick_auth';
        if(statusEl)statusEl.textContent='Tap passkey to unlock your confidential 1Click session...';
      }else if(!prepRes.ok){
        throw new Error((prep&&prep.error)||'Could not prepare payment approval.');
      }else if(prep&&prep.step==='shield'){
        if(statusEl)statusEl.textContent='Tap passkey to shield funds into Confidential Intents...';
      }else{
        const label=prep&&prep.recipientHandle?'@'+String(prep.recipientHandle).replace(/^@+/,''):'recipient';
        const idx=(typeof prep.recipientIndex==='number'&&typeof prep.totalRecipients==='number')
          ?' ('+(prep.recipientIndex+1)+' of '+prep.totalRecipients+')':'';
        if(statusEl)statusEl.textContent='Tap passkey to sign payment to '+label+idx+'...';
      }
      if(!prep||!prep.actionId||!prep.options){
        throw new Error((prep&&prep.error)||'Missing WebAuthn challenge from server.');
      }
      const cred=await navigator.credentials.get({publicKey:toPublicKeyOptions(prep.options)});
      if(!cred)throw new Error('Passkey signature was cancelled.');
      if(statusEl)statusEl.textContent='Submitting signed transaction...';
      const subRes=await fetch('/api/agent/approval/'+encodeURIComponent(approvalId)+'/submit',{
        method:'POST',
        credentials:'include',
        headers:{'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify({actionId:prep.actionId,assertion:serialize(cred),step})
      });
      const sub=await subRes.json().catch(()=>({}));
      if(!subRes.ok){
        throw new Error((sub&&sub.error)||'Failed to submit signed payment.');
      }
      if(sub&&sub.done){
        window.location.reload();
        return;
      }
    }
  }catch(e){
    if(statusEl)statusEl.textContent='';
    err.textContent=e&&e.message?e.message:'Passkey confirmation failed.';
    err.style.display='block';
    approve.disabled=false;
  }
});`;

  const script = isSelfCustody
    ? selfCustodyScript
    : recentPasskey
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

  const noticeText = isSelfCustody
    ? `Your UPRAIL account uses passkey self-custody — confirming with your passkey signs the on-chain transfer directly on your device.${isMultiple ? ` (${recipientCount} recipients will be signed in sequence.)` : ''}`
    : `Payment exceeds your ${payload.exceededReason === 'daily_limit' ? 'daily limit' : 'per-payment limit'}${typeof payload.limitUsd === 'number' ? ` ($${payload.limitUsd.toFixed(2)})` : ''}. Confirming with Passkey will execute the transfer immediately.`;

  return page(
    'Authorize AI Payment',
    `<div class="brand-bar">
       <div class="brand">
         <img src="/brand/uprail-icon.png" alt="UPRAIL">
         <span class="brand-name">UPRAIL</span>
       </div>
       <span class="badge">${isSelfCustody ? 'SELF-CUSTODY' : 'NEAR INTENTS'}</span>
     </div>
     
     <div class="agent-tag">🤖 ${escapeHtml(payload.agentName || 'AI Agent')}</div>
     <h1>Authorize ${isMultiple ? `${recipientCount} Payments` : 'Payment'}</h1>
     <p class="desc">${escapeHtml(payload.agentName || 'AI Agent')} requested a confidential payment${isSelfCustody ? ' requiring your device passkey signature' : ' exceeding your guardrail'}.</p>
     
     <div class="summary-box">
       <div>
         <span style="display:block;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700;font-family:var(--font-mono);margin-bottom:2px">Total Payment</span>
         <div class="summary-amount">${escapeHtml(payload.totalAmount)} ${escapeHtml(payload.asset)}</div>
       </div>
       <div class="summary-usd">~$${escapeHtml(payload.totalUsd.toFixed(2))} USD</div>
     </div>

     <div class="notice">${noticeText}</div>

     <div class="recipients-label">Recipient${isMultiple ? 's' : ''}</div>
     <div class="recipients">${recipientsHtml}</div>
     ${payload.memo ? `<div class="memo-box"><strong>Memo:</strong> ${escapeHtml(payload.memo)}</div>` : ''}

     <div class="error" id="error"></div>
     ${isSelfCustody ? '<div id="self-status" style="font-size:12px;color:var(--muted);margin-bottom:10px;text-align:center"></div>' : ''}

     <form id="approval-form" method="post" action="/approve/submit">
       <input type="hidden" name="id" value="${escapeHtml(approvalId)}">
       <input type="hidden" name="passkeyAssertion" id="passkeyAssertion" value="">
       <div class="actions">
         <button class="approve" id="approve" type="button">
           ${isSelfCustody ? 'Sign & Authorize with Passkey' : recentPasskey ? 'Approve & Send' : 'Confirm with Passkey'}
         </button>
         <button class="deny" type="submit" formaction="/approve/deny" formnovalidate>Reject</button>
       </div>
     </form>
     <div class="foot">
       ${isSelfCustody ? 'Direct on-chain WebAuthn signature · UPRAIL cannot sign without your device' : 'Authorized using WebAuthn passkeys · Sent from UPRAIL vault'}
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

  const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
  if (custody?.custodyMode === 'self') {
    return errorScreen(
      'Self-Custody Passkey Required',
      'This account uses self-custody. Use the "Sign & Authorize with Passkey" button on the approval screen so your device signs the transaction directly.',
      409
    );
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
    `<div class="brand-bar">
       <div class="brand">
         <img src="/brand/uprail-icon.png" alt="UPRAIL">
         <span class="brand-name">UPRAIL</span>
       </div>
       <span class="badge">DENIED</span>
     </div>
     <h1>Payment Rejected</h1>
     <p class="desc">You rejected this payment request. No funds left your account.</p>
     <div class="actions">
       <a href="https://app.uprail.world" class="btn approve" style="width:100%">Return to App</a>
     </div>
     <div class="foot">Return to your AI app or close this page.</div>`
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

interface LoadedApprovalContext {
  session: NonNullable<ReturnType<Context<AppContext>['get']> extends infer _ ? Context<AppContext>['var']['session'] : never>;
  row: any;
  payload: ApprovalPayload;
  completedPayments: any[];
}

async function loadSelfCustodyApproval(
  c: Context<AppContext>,
  approvalId: string
): Promise<{ ok: true; data: LoadedApprovalContext } | { ok: false; response: Response }> {
  const session = c.get('session');
  if (!session) {
    return { ok: false, response: c.json({ error: 'Authentication required', code: 'UNAUTHORIZED' }, 401) };
  }

  const row = await c.env.DB.prepare(
    'SELECT id, x_id, agent_key_id, payload, status, result, created_at, expires_at FROM agent_approvals WHERE id = ?'
  )
    .bind(approvalId)
    .first<any>();

  if (!row) {
    return { ok: false, response: c.json({ error: 'Approval request not found.', code: 'NOT_FOUND' }, 404) };
  }
  if (row.x_id !== session.x_id) {
    return {
      ok: false,
      response: c.json({ error: 'Approval request belongs to another account.', code: 'FORBIDDEN' }, 403),
    };
  }

  const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
  if (custody?.custodyMode !== 'self') {
    return {
      ok: false,
      response: c.json(
        { error: 'Direct WebAuthn signing is only used for self-custody accounts.', code: 'NOT_SELF_CUSTODY' },
        400
      ),
    };
  }

  let payload: ApprovalPayload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return { ok: false, response: c.json({ error: 'Malformed approval payload.', code: 'INVALID_PAYLOAD' }, 500) };
  }

  let completedPayments: any[] = [];
  if (row.result) {
    try {
      const parsed = JSON.parse(row.result);
      if (Array.isArray(parsed?.payments)) {
        completedPayments = parsed.payments;
      }
    } catch {}
  }

  if (row.status === 'APPROVED') {
    return {
      ok: false,
      response: c.json({ done: true, status: 'APPROVED', payments: completedPayments }),
    };
  }
  if (row.status !== 'PENDING') {
    return {
      ok: false,
      response: c.json(
        { error: `This approval request is ${String(row.status).toLowerCase()}.`, code: 'INVALID_STATUS' },
        409
      ),
    };
  }
  if (row.expires_at < Date.now()) {
    return { ok: false, response: c.json({ error: 'Approval request expired.', code: 'EXPIRED' }, 410) };
  }

  return {
    ok: true,
    data: { session, row, payload, completedPayments },
  };
}

approvalRouter.post('/api/agent/approval/:id/prepare', async (c) => {
  try {
    const approvalId = c.req.param('id');
    const loaded = await loadSelfCustodyApproval(c, approvalId);
    if (!loaded.ok) return loaded.response;

    const { session, payload, completedPayments } = loaded.data;
    if (completedPayments.length >= payload.recipients.length) {
      await c.env.DB.prepare(
        "UPDATE agent_approvals SET status = 'APPROVED', decided_at = ? WHERE id = ? AND status = 'PENDING'"
      )
        .bind(Date.now(), approvalId)
        .run();
      return c.json({ done: true, status: 'APPROVED', payments: completedPayments });
    }

    const targetIndex = completedPayments.length;
    const recipient = payload.recipients[targetIndex];
    const recipientHandle = recipient.recipientHandle.replace(/^@+/, '');

    const quoteReq = new Request('https://uprail.internal/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientHandle, asset: payload.asset, amount: recipient.amount }),
    });
    const quoteRes = await paymentsRouter.fetch(quoteReq, c.env, c.executionCtx);
    if (!quoteRes.ok) {
      return c.json(
        { error: `Failed to quote payment to @${recipientHandle}`, code: 'QUOTE_FAILED' },
        502
      );
    }
    const quote = (await quoteRes.json()) as { quoteSignature: string; depositAddress: string };

    const prepared = await prepareSelfCustodySend(c.env, session, {
      recipientHandle,
      asset: payload.asset,
      amount: recipient.amount,
      memo: payload.memo,
      quoteSignature: quote.quoteSignature,
      depositAddress: quote.depositAddress,
    });

    return c.json({
      ...prepared,
      recipientIndex: targetIndex,
      totalRecipients: payload.recipients.length,
      recipientHandle,
      amount: recipient.amount,
      asset: payload.asset,
    });
  } catch (err) {
    return handleCustodyActionError(c, err, 'APPROVAL_PREPARE_FAILED', '[approval/prepare]');
  }
});

approvalRouter.post('/api/agent/approval/:id/submit', async (c) => {
  try {
    const approvalId = c.req.param('id');
    const loaded = await loadSelfCustodyApproval(c, approvalId);
    if (!loaded.ok) return loaded.response;

    const { session, payload, completedPayments } = loaded.data;
    const body = await c.req
      .json<{ actionId?: string; assertion?: unknown; step?: string }>()
      .catch(() => null);
    if (!body?.actionId || !body?.assertion) {
      return c.json({ error: 'Missing actionId or WebAuthn assertion', code: 'INVALID_REQUEST' }, 400);
    }

    if (body.step === 'oneclick_auth') {
      await submitOneClickWebAuthnSession({
        env: c.env,
        xId: session.x_id,
        actionId: body.actionId,
        assertion: body.assertion,
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      return c.json({ step: 'oneclick_auth_complete', nextAction: true, done: false });
    }

    if (completedPayments.length >= payload.recipients.length) {
      return c.json({ done: true, status: 'APPROVED', payments: completedPayments });
    }

    const result = await submitSelfCustodySend({
      env: c.env,
      session,
      actionId: body.actionId,
      assertion: body.assertion,
      step: body.step,
    });
    await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });

    const payment = (result as any)?.payment;
    if (!payment) {
      return c.json({ ...(result as Record<string, unknown>), done: false });
    }

    const entry = {
      recipientHandle: String(payment.recipientHandle || '').replace(/^@+/, ''),
      amount: String(payment.amount ?? ''),
      asset: String(payment.asset || payload.asset),
      paymentId: payment.paymentId,
      shareLink: payment.shareLink,
      claimLink: payment.claimLink || payment.shareLink,
      xShareUrl: payment.xShareUrl,
      tweetIntentUrl: payment.tweetIntentUrl,
      status: payment.status,
    };
    const nextPayments = [...completedPayments, entry];
    const allDone = nextPayments.length >= payload.recipients.length;

    await c.env.DB.prepare(
      'UPDATE agent_approvals SET status = ?, result = ?, decided_at = ? WHERE id = ?'
    )
      .bind(
        allDone ? 'APPROVED' : 'PENDING',
        JSON.stringify({
          payments: nextPayments,
          shareLinks: nextPayments.map((x) => x.shareLink).filter(Boolean),
        }),
        allDone ? Date.now() : null,
        approvalId
      )
      .run();

    return c.json({
      done: allDone,
      completedCount: nextPayments.length,
      totalRecipients: payload.recipients.length,
      payment,
      payments: nextPayments,
    });
  } catch (err) {
    return handleCustodyActionError(c, err, 'APPROVAL_SUBMIT_FAILED', '[approval/submit]');
  }
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
          <strong style="color:var(--fg);font-size:13.5px">@${escapeHtml(handle)}</strong>
          <span style="color:#059669;font-weight:700;font-size:13px;font-family:var(--font-mono)">${escapeHtml(p.amount)} ${escapeHtml(p.asset)}</span>
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
         <img src="/brand/uprail-icon.png" alt="UPRAIL">
         <span class="brand-name">UPRAIL</span>
       </div>
       <span class="badge">CONFIRMED</span>
     </div>
     <div class="success-card">
       <strong>Payment Authorized & Settled</strong>
       <span>Your passkey signed the transfer. Funds have left your vault.</span>
     </div>
     <h1>Share Claim Links</h1>
     <p class="desc">Share these links with each recipient on X to view the confidential receipt:</p>
     <div class="links-list">${linksHtml}</div>
     <div class="foot">
       Your AI agent can also read these confirmed links via UPRAIL MCP.
     </div>`
  );
}
