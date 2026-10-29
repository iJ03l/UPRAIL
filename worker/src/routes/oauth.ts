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
  margin-bottom: 22px;
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
  margin: 0 0 8px;
  color: var(--text);
  font-weight: 700;
}
p.desc {
  margin: 0 0 20px;
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.5;
}

.bridge {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  background: rgba(14, 11, 9, 0.7);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 14px 16px;
  margin: 18px 0;
}
.bridge-node {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.bridge-node.right {
  justify-content: flex-end;
  text-align: right;
}
.bridge-avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #231B16;
  border: 1px solid rgba(44, 34, 29, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}
.bridge-avatar.vault {
  background: #1c140f;
  border-color: rgba(224, 83, 38, 0.4);
  box-shadow: 0 0 14px rgba(224, 83, 38, 0.2);
}
.bridge-meta strong {
  display: block;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bridge-meta small {
  display: block;
  font-size: 11px;
  color: var(--muted);
  font-family: var(--font-mono);
}
.bridge-wire {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.bridge-pill {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: 999px;
  background: #2a1a12;
  border: 1px solid #4a2a1b;
  color: #f0a07e;
}

.capabilities {
  display: grid;
  gap: 8px;
  margin: 18px 0;
}
.cap-tile {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(18, 14, 12, 0.6);
  border: 1px solid rgba(44, 34, 29, 0.7);
  border-radius: 14px;
  padding: 10px 14px;
  font-size: 13px;
  color: #D6D3D1;
}
.cap-icon {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: rgba(224, 83, 38, 0.12);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  flex-shrink: 0;
}

.limits {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 18px 0 14px;
}
.limit-card {
  background: rgba(14, 11, 9, 0.85);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 12px 14px;
  transition: border-color 0.2s ease;
}
.limit-card:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(224, 83, 38, 0.18);
}
.limit-label {
  display: block;
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  font-weight: 700;
  margin-bottom: 6px;
}
.limit-input-wrap {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.limit-symbol {
  color: var(--accent);
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 18px;
}
input[type=number] {
  width: 100%;
  background: transparent;
  border: 0;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 700;
  padding: 0;
  outline: none;
}
.field {
  background: rgba(14, 11, 9, 0.85);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.field:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(224, 83, 38, 0.18);
}
.field-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.field-header label {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  font-weight: 700;
}
.field-header span {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--subtle);
}
.field-input-wrap {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.field-input-wrap input {
  font-size: 16px;
}
.field-unit {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--subtle);
}
.hint {
  font-size: 11.5px;
  color: var(--subtle);
  margin: -6px 0 18px;
  line-height: 1.45;
}
.notice {
  border: 1px solid #4a2a1b;
  background: #23140e;
  color: #fdba74;
  border-radius: 14px;
  padding: 11px 14px;
  font-size: 12px;
  line-height: 1.45;
  margin: 14px 0;
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
button:disabled {
  opacity: 0.6;
  cursor: wait;
  transform: none !important;
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
@media (max-width: 480px) {
  .card { padding: 22px 18px; }
  .limits { grid-template-columns: 1fr; }
  h1 { font-size: 23px; }
  .bridge { grid-template-columns: 1fr; gap: 8px; text-align: left; }
  .bridge-node.right { justify-content: flex-start; text-align: left; }
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
         <div class="brand-icon-wrap"><img src="/brand/uprail-icon.png" alt="UPRAIL"></div>
         <span class="brand-name">UPRAIL</span>
       </div>
       <div class="protocol-badge"><span class="pulse-dot"></span><span>OAUTH 2.1</span></div>
     </div>
     <h1>Couldn’t connect</h1>
     <p class="desc">${escapeHtml(message)}</p>
     <div class="actions">
       <a href="https://app.uprail.world" class="btn approve" style="text-decoration:none;width:100%">Return to Dashboard</a>
     </div>
     <p class="foot">Return to your AI app and initiate the connection again.</p>`
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
         <div class="brand-icon-wrap"><img src="/brand/uprail-icon.png" alt="UPRAIL"></div>
         <span class="brand-name">UPRAIL</span>
       </div>
       <div class="protocol-badge"><span class="pulse-dot"></span><span>NEAR INTENTS · MCP 2.1</span></div>
     </div>
     
     <h1>Connect ${escapeHtml(clientName)}</h1>
     <p class="desc">Authorize this AI assistant to execute confidential payments and check balances through your UPRAIL vault, protected by passkeys and deterministic spend caps.</p>
     
     <div class="bridge">
       <div class="bridge-node">
         <div class="bridge-avatar">🤖</div>
         <div class="bridge-meta">
           <strong>${escapeHtml(clientName)}</strong>
           <small>${clientDomain ? escapeHtml(clientDomain) : 'AI Client'}</small>
         </div>
       </div>
       <div class="bridge-wire">
         <span class="bridge-pill">MCP 2.1</span>
       </div>
       <div class="bridge-node right">
         <div class="bridge-meta">
           <strong>@${escapeHtml(handle.replace(/^@+/, ''))}</strong>
           <small>UPRAIL Vault</small>
         </div>
         <div class="bridge-avatar vault">🛡️</div>
       </div>
     </div>

     <div class="capabilities">
       <div class="cap-tile">
         <span class="cap-icon">✦</span>
         <span>Send payments to any X handle directly from chat</span>
       </div>
       <div class="cap-tile">
         <span class="cap-icon">◈</span>
         <span>Check vault balances and recent confidential receipts</span>
       </div>
       <div class="cap-tile">
         <span class="cap-icon">❖</span>
         <span>Generate deposit addresses and withdraw to 35+ blockchains</span>
       </div>
     </div>

     <form id="consent-form" method="post" action="/authorize/approve">
       <input type="hidden" name="handle" value="${escapeHtml(handle)}">
       <input type="hidden" name="passkeyAssertion" id="passkeyAssertion" value="">
       
       <div class="limits">
         <div class="limit-card">
           <label class="limit-label" for="per_tx_limit">Max per payment</label>
           <div class="limit-input-wrap">
             <span class="limit-symbol">$</span>
             <input id="per_tx_limit" name="per_tx_limit" form="consent-form" type="number" min="0.01" max="100000" step="0.01" value="${perTx}">
           </div>
         </div>
         <div class="limit-card">
           <label class="limit-label" for="daily_limit">Max per day</label>
           <div class="limit-input-wrap">
             <span class="limit-symbol">$</span>
             <input id="daily_limit" name="daily_limit" form="consent-form" type="number" min="0.01" max="100000" step="0.01" value="${daily}">
           </div>
         </div>
       </div>

       <div class="field">
         <div class="field-header">
           <label for="connection_days">Connection duration</label>
           <span>Auto-revokes</span>
         </div>
         <div class="field-input-wrap">
           <input id="connection_days" name="connection_days" form="consent-form" type="number" min="1" max="${OAUTH_MAX_CONNECTION_DAYS}" step="1" value="${connectionDays}">
           <span class="field-unit">DAYS (1–${OAUTH_MAX_CONNECTION_DAYS})</span>
         </div>
       </div>
       
       <p class="hint">Every transaction is checked atomically against your spend guardrails in Cloudflare D1. You can revoke this connection at any time in AI Chat settings.</p>
       
       ${redirectIsLoopback ? `<div class="notice">⚡ Local app detected: This authorization returns to <strong>${escapeHtml(redirectHost)}</strong> on this machine. Only proceed if you initiated this connection.</div>` : ''}
       ${error ? `<div class="error" style="display:block">${escapeHtml(error)}</div>` : `<div class="error" id="error"></div>`}

       <div class="actions">
         <button class="approve" id="approve" type="submit">
           <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 0-10 10c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z"/></svg>
           <span>${recentPasskey ? 'Authorize Connection' : 'Confirm with Passkey (Touch / Face ID)'}</span>
         </button>
         <button class="deny" type="submit" formaction="/authorize/deny" formnovalidate>Deny</button>
       </div>
     </form>

     <div class="foot">
       <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
       <span>Secured by WebAuthn Hardware Passkeys · Settle on NEAR Intents</span>
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
