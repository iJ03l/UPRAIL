import { Hono } from 'hono';
import { AuthorizationError } from '@cloudflare/workers-oauth-provider';
import type { AppContext, Env } from '../types';
import { getAuthorizationServer, getOAuthConfig, OAUTH_SCOPE, OAUTH_CONNECTION_DAYS, OAUTH_MAX_CONNECTION_DAYS } from '../oauth/authorization';
import { hasRecentPasskey, verifyPasskeyAssertion } from '../middleware/passkeyAuth';
import { updateSession } from '../middleware/session';
import {
  AGENT_DEFAULT_DAILY_USD,
  AGENT_DEFAULT_PER_TX_USD,
  deleteAbortedOAuthAgentKey,
  parseAgentUsdLimit,
  upsertOAuthAgentKey,
} from '../services/agentKeys';

export const oauthRouter = new Hono<AppContext>();

const RESUME_TTL_SECONDS = 600;

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
  margin: 0 0 18px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}
.client-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fafaf9;
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 12px 14px;
  margin-bottom: 16px;
}
.client-info strong {
  display: block;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--fg);
}
.client-info small {
  display: block;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--muted);
}
.vault-tag {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--fg);
  background: #ffffff;
  border: 1px solid var(--line);
  padding: 3px 8px;
  border-radius: 8px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
  display: grid;
  gap: 8px;
}
.list li {
  display: flex;
  gap: 8px;
  align-items: center;
  color: #44403c;
  font-size: 12.5px;
}
.list li svg {
  width: 14px;
  height: 14px;
  color: #059669;
  flex-shrink: 0;
}
.limits {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}
.limit-box {
  background: #fafaf9;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 9px 12px;
}
.limit-box:focus-within {
  border-color: var(--fg);
  background: #ffffff;
}
.label {
  display: block;
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin-bottom: 3px;
}
.input-row {
  display: flex;
  align-items: center;
  gap: 3px;
}
.currency {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  color: var(--muted);
}
input[type=number] {
  width: 100%;
  background: transparent;
  border: 0;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  padding: 0;
  outline: none;
}
.field {
  background: #fafaf9;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 9px 12px;
  margin-bottom: 12px;
}
.field:focus-within {
  border-color: var(--fg);
  background: #ffffff;
}
.field-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 3px;
}
.hint {
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 16px;
  line-height: 1.4;
}
.notice {
  border: 1px solid #fed7aa;
  background: #fff7ed;
  color: #9a3412;
  border-radius: 12px;
  padding: 9px 12px;
  font-size: 11px;
  margin: 12px 0;
  line-height: 1.4;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
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
  .limits { grid-template-columns: 1fr; }
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

function errorPage(message: string, status = 400): Response {
  return page(
    'Connection failed',
    `<div class="brand-bar">
       <div class="brand">
         <img src="/brand/uprail-icon.png" alt="UPRAIL">
         <span class="brand-name">UPRAIL</span>
       </div>
       <span class="badge">OAUTH 2.1</span>
     </div>
     <h1>Couldn’t connect</h1>
     <p class="desc">${escapeHtml(message)}</p>
     <div class="actions">
       <a href="https://app.uprail.world" class="btn approve" style="width:100%">Return to App</a>
     </div>`
  );
}

async function storeResume(env: Env, path: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.OAUTH_KV.put(
    `authorize_resume:${id}`,
    JSON.stringify({ path, createdAt: Date.now() }),
    { expirationTtl: RESUME_TTL_SECONDS }
  );
  return id;
}

async function takeResume(env: Env, id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const key = `authorize_resume:${id}`;
  const raw = await env.OAUTH_KV.get(key);
  if (!raw) return null;
  await env.OAUTH_KV.delete(key);
  try {
    const parsed = JSON.parse(raw) as { path?: string };
    if (!parsed.path || !parsed.path.startsWith('/authorize')) return null;
    return parsed.path;
  } catch {
    return null;
  }
}

function consentPage(options: {
  handle: string;
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  recentPasskey: boolean;
  perTx: number;
  daily: number;
  connectionDays: number;
  error?: string;
}): Response {
  const {
    handle,
    clientName,
    clientDomain,
    redirectHost,
    redirectIsLoopback,
    recentPasskey,
    perTx,
    daily,
    connectionDays,
    error,
  } = options;

  const script = recentPasskey
    ? `const form=document.getElementById('consent-form');const err=document.getElementById('error');const approve=document.getElementById('approve');approve.addEventListener('click',()=>{approve.disabled=true;form.submit()});`
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
const form=document.getElementById('consent-form');
const err=document.getElementById('error');
const approve=document.getElementById('approve');
const assertion=document.getElementById('passkeyAssertion');
approve.addEventListener('click',async()=>{
  approve.disabled=true;err.style.display='none';
  try{
    const res=await fetch('/api/auth-challenge',{credentials:'include',headers:{accept:'application/json'}});
    if(!res.ok)throw new Error('Could not start passkey authorization. Sign in again and retry.');
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

  return page(
    `Connect ${clientName}`,
    `<div class="brand-bar">
       <div class="brand">
         <img src="/brand/uprail-icon.png" alt="UPRAIL">
         <span class="brand-name">UPRAIL</span>
       </div>
       <span class="badge">OAUTH 2.1 · MCP</span>
     </div>
     
     <h1>Connect ${escapeHtml(clientName)}</h1>
     <p class="desc">Allow ${escapeHtml(clientName)} to send payments from your UPRAIL vault.</p>
     
     <div class="client-box">
       <div class="client-info">
         <strong>${escapeHtml(clientName)}</strong>
         <small>${clientDomain ? escapeHtml(clientDomain) : 'AI Assistant'}</small>
       </div>
       <span class="vault-tag">@${escapeHtml(handle.replace(/^@+/, ''))}</span>
     </div>

     <ul class="list">
       <li>
         <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
         <span>Send payments to any @handle</span>
       </li>
       <li>
         <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
         <span>Check vault balances</span>
       </li>
       <li>
         <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
         <span>Withdraw to external wallets</span>
       </li>
     </ul>

     <form id="consent-form" method="post" action="/authorize/approve">
       <input type="hidden" name="handle" value="${escapeHtml(handle)}">
       <input type="hidden" name="passkeyAssertion" id="passkeyAssertion" value="">
       
       <div class="limits">
         <div class="limit-box">
           <label class="label" for="per_tx_limit">Max per payment</label>
           <div class="input-row">
             <span class="currency">$</span>
             <input id="per_tx_limit" name="per_tx_limit" form="consent-form" type="number" min="0.01" max="100000" step="0.01" value="${perTx}">
           </div>
         </div>
         <div class="limit-box">
           <label class="label" for="daily_limit">Max per day</label>
           <div class="input-row">
             <span class="currency">$</span>
             <input id="daily_limit" name="daily_limit" form="consent-form" type="number" min="0.01" max="100000" step="0.01" value="${daily}">
           </div>
         </div>
       </div>

       <div class="field">
         <div class="field-header">
           <label class="label" for="connection_days">Duration (Days)</label>
           <span style="font-size:10px;color:var(--muted);font-family:var(--font-mono)">1–${OAUTH_MAX_CONNECTION_DAYS} days</span>
         </div>
         <div class="input-row">
           <input id="connection_days" name="connection_days" form="consent-form" type="number" min="1" max="${OAUTH_MAX_CONNECTION_DAYS}" step="1" value="${connectionDays}">
         </div>
       </div>

       <p class="hint">Payments are checked against these limits. Revocable at any time.</p>
       
       ${redirectIsLoopback ? `<div class="notice">Returns to local app on <strong>${escapeHtml(redirectHost)}</strong>.</div>` : ''}
       ${error ? `<div class="error" style="display:block">${escapeHtml(error)}</div>` : `<div class="error" id="error"></div>`}

       <div class="actions">
         <button class="approve" id="approve" type="submit">
           ${recentPasskey ? 'Allow access' : 'Confirm with Passkey'}
         </button>
         <button class="deny" type="submit" formaction="/authorize/deny" formnovalidate>Deny</button>
       </div>
     </form>

     <div class="foot">
       Protected by WebAuthn passkeys · Tokens sent to ${escapeHtml(redirectHost)}
     </div>
     <script>${script}</script>`
  );
}

oauthRouter.get('/authorize', async (c) => {
  const requestUrl = new URL(c.req.url);
  const issuerUrl = new URL(getOAuthConfig(c.env).issuer);
  if (requestUrl.origin !== issuerUrl.origin) {
    return c.redirect(`${issuerUrl.origin}/authorize${requestUrl.search}`, 302);
  }

  const resumeId = c.req.query('resume');
  let authUrl = c.req.url;
  if (resumeId) {
    const stored = await takeResume(c.env, resumeId);
    if (!stored) {
      return errorPage('Your sign-in expired before the connection was approved. Start again from your AI app.');
    }
    authUrl = new URL(stored, requestUrl.origin).toString();
  }

  const session = c.get('session');
  if (!session) {
    if (resumeId) return errorPage('Sign in again to continue connecting your AI app.');
    const id = await storeResume(c.env, `${requestUrl.pathname}${requestUrl.search}`);
    const returnTo = encodeURIComponent(`/authorize?resume=${id}`);
    return c.redirect(`/auth/x/login?return_to=${returnTo}`, 302);
  }

  const oauth = getAuthorizationServer(c.env).getOAuthApi(c.env);
  try {
    const authRequest = await oauth.parseAuthRequest(new Request(authUrl));
    const description = await oauth.describeConsent(authRequest);
    const transaction = await oauth.beginConsent(authRequest);
    const response = consentPage({
      handle: transaction.handle,
      clientName: description.clientName,
      clientDomain: description.clientDomain,
      redirectHost: description.redirectHost,
      redirectIsLoopback: description.redirectIsLoopback,
      recentPasskey: hasRecentPasskey(session),
      perTx: AGENT_DEFAULT_PER_TX_USD,
      daily: AGENT_DEFAULT_DAILY_USD,
      connectionDays: OAUTH_CONNECTION_DAYS,
    });
    for (const [key, value] of transaction.headers) response.headers.append(key, value);
    return response;
  } catch (err) {
    if (err instanceof AuthorizationError && err.redirectTo) {
      return c.redirect(err.redirectTo, 302);
    }
    console.error('[oauth] authorize failed:', err);
    return errorPage('This connection request is invalid or has expired. Start again from your AI app.');
  }
});

oauthRouter.post('/authorize/approve', async (c) => {
  const session = c.get('session');
  if (!session) return errorPage('Your session expired. Start the connection again from your AI app.', 401);

  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return errorPage('Invalid approval request.');
  }

  const handle = String(form.get('handle') || '');
  const perTx = parseAgentUsdLimit(form.get('per_tx_limit'), AGENT_DEFAULT_PER_TX_USD);
  const daily = parseAgentUsdLimit(form.get('daily_limit'), AGENT_DEFAULT_DAILY_USD);
  const rawDays = String(form.get('connection_days') ?? '').trim();
  const connectionDays = rawDays === '' ? OAUTH_CONNECTION_DAYS : Number(rawDays);
  if (!handle) return errorPage('This approval request is missing its security handle.');
  if (perTx === null || daily === null) {
    return errorPage('Enter valid limits between $0.01 and $100,000.');
  }
  if (perTx > daily) {
    return errorPage('The per-payment limit cannot be higher than the daily limit.');
  }
  if (
    !Number.isInteger(connectionDays) ||
    connectionDays < 1 ||
    connectionDays > OAUTH_MAX_CONNECTION_DAYS
  ) {
    return errorPage(`Choose a connection duration between 1 and ${OAUTH_MAX_CONNECTION_DAYS} days.`);
  }

  if (!hasRecentPasskey(session)) {
    const rawAssertion = String(form.get('passkeyAssertion') || '');
    if (!rawAssertion) {
      return errorPage('Confirm with Face ID or fingerprint to continue.', 403);
    }
    let assertion: any;
    try {
      assertion = JSON.parse(rawAssertion);
    } catch {
      return errorPage('The passkey confirmation was malformed. Try again.', 400);
    }
    const verified = await verifyPasskeyAssertion(c.env, session.x_id, assertion);
    if (!verified.ok) return errorPage(verified.message, verified.status);
    await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
  }

  const oauth = getAuthorizationServer(c.env).getOAuthApi(c.env);
  let approved;
  try {
    approved = await oauth.approveConsent(c.req.raw, handle, { scope: [OAUTH_SCOPE] });
  } catch (err) {
    console.error('[oauth] consent approval failed:', err);
    return errorPage('This approval expired. Start the connection again from your AI app.');
  }

  let key: Awaited<ReturnType<typeof upsertOAuthAgentKey>> | null = null;
  try {
    const description = await oauth.describeConsent(approved.request);
    key = await upsertOAuthAgentKey(c.env, {
      xId: session.x_id,
      clientId: approved.request.clientId,
      clientName: description.clientName,
      perTxUsd: perTx,
      dailyUsd: daily,
      expiresAt: Date.now() + connectionDays * 86400 * 1000,
    });

    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: session.x_id,
      metadata: {
        agentKeyId: key.keyId,
        authMethod: 'oauth',
        clientName: description.clientName,
        perTxUsd: perTx,
        dailyUsd: daily,
      },
      scope: [OAUTH_SCOPE],
      props: { agentKeyId: key.keyId },
      revokeExistingGrants: true,
    });

    const headers = new Headers(approved.headers);
    headers.set('Location', redirectTo);
    headers.set('Cache-Control', 'no-store');
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error('[oauth] complete authorization failed:', err);
    if (key?.created) {
      await deleteAbortedOAuthAgentKey(c.env, key.keyId, key.agentId).catch((cleanupErr) => {
        console.error('[oauth] aborted key cleanup failed:', cleanupErr);
      });
    }
    return errorPage('Could not finish connecting this app. Please try again.');
  }
});

oauthRouter.post('/authorize/deny', async (c) => {
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return errorPage('Invalid denial request.');
  }
  const handle = String(form.get('handle') || '');
  if (!handle) return errorPage('This request is missing its security handle.');

  const oauth = getAuthorizationServer(c.env).getOAuthApi(c.env);
  try {
    const denied = await oauth.denyConsent(c.req.raw, handle);
    const headers = new Headers(denied.headers);
    headers.set('Location', denied.redirectTo);
    headers.set('Cache-Control', 'no-store');
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error('[oauth] consent denial failed:', err);
    return errorPage('This request expired. No access was granted.');
  }
});
