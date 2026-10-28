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
<title>${escapeHtml(title)} — UPRAIL</title>
<style>
:root{color-scheme:dark;--bg:#0c0a09;--panel:#171412;--line:#2b2521;--text:#f5f5f4;--muted:#a8a29e;--accent:#e05326}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 600px at 50% -10%,#2a1610 0%,var(--bg) 55%);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:100%;max-width:560px;background:linear-gradient(180deg,#1c1917,#141210);border:1px solid var(--line);border-radius:24px;padding:30px;box-shadow:0 30px 80px -30px #000}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;font-size:11px;color:var(--muted);margin-bottom:22px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 18px var(--accent)}
h1{font-size:27px;line-height:1.15;letter-spacing:-.03em;margin:0 0 10px}
p{margin:0 0 16px;color:var(--muted)}
.client{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 16px;border:1px solid var(--line);border-radius:16px;background:#0f0d0c;margin:20px 0}
.client strong{display:block;font-size:15px;color:var(--text)}
.client small{display:block;color:var(--muted);font-size:12px;margin-top:2px;word-break:break-word}
.badge{flex:none;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;padding:6px 9px;border-radius:999px;background:#2a1a12;border:1px solid #4a2a1b;color:#f0a07e}
.list{list-style:none;padding:0;margin:18px 0;display:grid;gap:9px}
.list li{display:flex;gap:10px;align-items:flex-start;color:#d6d3d1;font-size:14px}
.tick{color:var(--accent);font-weight:800}
.limits{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0}
label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:7px;font-weight:700}
.input{display:flex;align-items:center;gap:8px;background:#0f0d0c;border:1px solid var(--line);border-radius:13px;padding:0 12px}
.input span{color:var(--muted);font-weight:700}
input[type=number]{width:100%;background:transparent;border:0;color:var(--text);font:inherit;font-weight:700;padding:12px 0;outline:none}
.hint{font-size:12px;color:#78716c;margin:-8px 0 18px}
.field{margin:0 0 18px}
.notice{border:1px solid #4a2a1b;background:#23140e;color:#fdba74;border-radius:13px;padding:11px 13px;font-size:12px;margin:16px 0}
.actions{display:flex;gap:10px;margin-top:22px}
button{font:inherit;font-weight:800;border-radius:14px;padding:13px 18px;border:1px solid transparent;cursor:pointer}
.approve{flex:1;background:var(--text);color:#0c0a09}
.deny{background:transparent;color:var(--muted);border-color:var(--line)}
button:disabled{opacity:.55;cursor:wait}
.error{border:1px solid #5b1f1f;background:#2a1111;color:#fca5a5;border-radius:13px;padding:11px 13px;font-size:13px;margin:16px 0;display:none}
.foot{font-size:11px;color:#57534e;margin:18px 0 0;line-height:1.5}
@media(max-width:480px){.card{padding:22px}.limits{grid-template-columns:1fr}h1{font-size:24px}}
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
    `<div class="brand"><span class="dot"></span>UPRAIL</div>
     <h1>Couldn’t connect</h1>
     <p>${escapeHtml(message)}</p>
     <p class="foot">Return to your AI app and start the connection again.</p>`
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
    if(!res.ok)throw new Error('Could not start Face ID. Sign in again and retry.');
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
    'Connect an AI app',
    `<div class="brand"><span class="dot"></span>UPRAIL</div>
     <h1>Connect ${escapeHtml(clientName)}</h1>
     <p>This app wants to use your UPRAIL balance to send and receive confidential payments.</p>
     <div class="client">
       <div>
         <strong>${escapeHtml(clientName)}</strong>
         <small>${clientDomain ? `Client domain: ${escapeHtml(clientDomain)}` : 'App identity is self-reported'}</small>
       </div>
       <span class="badge">MCP</span>
     </div>
     <ul class="list">
       <li><span class="tick">✓</span><span>Send payments to any X handle</span></li>
       <li><span class="tick">✓</span><span>Check balances and recent payments</span></li>
       <li><span class="tick">✓</span><span>Generate deposit addresses and withdraw to a wallet</span></li>
     </ul>
     <form id="consent-form" method="post" action="/authorize/approve">
       <input type="hidden" name="handle" value="${escapeHtml(handle)}">
       <input type="hidden" name="passkeyAssertion" id="passkeyAssertion" value="">
       <div class="limits">
         <div><label for="per_tx_limit">Max per payment</label><div class="input"><span>$</span><input id="per_tx_limit" name="per_tx_limit" form="consent-form" type="number" min="0.01" max="100000" step="0.01" value="${perTx}"></div></div>
         <div><label for="daily_limit">Max per day</label><div class="input"><span>$</span><input id="daily_limit" name="daily_limit" form="consent-form" type="number" min="0.01" max="100000" step="0.01" value="${daily}"></div></div>
       </div>
       <div class="field">
         <label for="connection_days">Connection expires in days</label>
         <div class="input"><input id="connection_days" name="connection_days" form="consent-form" type="number" min="1" max="${OAUTH_MAX_CONNECTION_DAYS}" step="1" value="${connectionDays}"></div>
       </div>
       <p class="hint">Choose 1–${OAUTH_MAX_CONNECTION_DAYS} days. You can disconnect sooner in AI Chat settings. Every payment is checked against these limits.</p>
       ${redirectIsLoopback ? `<div class="notice">This connection returns to an app on this computer (${escapeHtml(redirectHost)}). Only continue if you started it.</div>` : ''}
       ${error ? `<div class="error" style="display:block">${escapeHtml(error)}</div>` : `<div class="error" id="error"></div>`}
       <div class="actions">
         <button class="approve" id="approve" type="submit">${recentPasskey ? 'Allow access' : 'Confirm with Face ID'}</button>
         <button class="deny" type="submit" formaction="/authorize/deny" formnovalidate>Deny</button>
       </div>
     </form>
     <p class="foot">Tokens are sent to ${escapeHtml(redirectHost)}. You can disconnect this app at any time from AI Chat settings.</p>
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
