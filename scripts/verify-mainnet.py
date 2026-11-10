#!/usr/bin/env python3
"""
UPRAIL: Live Mainnet & Feature Verification Suite

Zero-dependency, read-only verification for NEAR Hackathon judges & automated evaluators:
  [1/10] Mainnet Sponsor & Escrow Factory (escrow.uprail.near)
  [2/10] Deterministic User Sub-Account (u_fc982587d85af44f.escrow.uprail.near)
  [3/10] NEAR Intents Key Registration (intents.near::has_public_key)
  [4/10] Production Worker Health (api.uprail.world/health)
  [5/10] Public @handle -> Vault Resolution (/api/resolve)
  [6/10] 35+ Chain Token Registry & Live Price Oracle (/api/onchain/tokens + /price)
  [7/10] AI Agent OpenAPI 3.1.0 Spec (/api/agent/openapi.json)
  [8/10] OAuth 2.1 & Remote MCP Discovery (RFC 8414 + RFC 9728)
  [9/10] Launchpad Creator-Fee Routing Config (/api/launchpads/config)
 [10/10] Fail-Closed Anti-BAC Auth Guard (/api/payments -> 401)
"""

import sys, json, base64, urllib.request, urllib.error

RPC_ENDPOINTS = [
    'https://free.rpc.fastnear.com',
    'https://rpc.mainnet.near.org',
    'https://mainnet.neardata.xyz/v1/rpc'
]

def call_rpc(method, params):
    payload = json.dumps({
        'jsonrpc': '2.0',
        'id': 'verify',
        'method': method,
        'params': params
    }).encode('utf-8')

    last_err = None
    for ep in RPC_ENDPOINTS:
        try:
            req = urllib.request.Request(
                ep,
                data=payload,
                headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}
            )
            with urllib.request.urlopen(req, timeout=12) as res:
                data = json.loads(res.read().decode('utf-8'))
                if 'error' in data:
                    last_err = Exception(data['error'].get('message', str(data['error'])))
                    continue
                return data.get('result')
        except Exception as e:
            last_err = e
    raise last_err or Exception('All RPC endpoints failed')

def http_get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=12) as res:
        return json.loads(res.read().decode('utf-8'))

def http_status(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=12) as res:
            return res.status
    except urllib.error.HTTPError as e:
        return e.code

def main():
    print('=================================================================')
    print('⚡ UPRAIL: Live Mainnet & Full-Feature Verification (10 Checks)')
    print('=================================================================\n')

    passed = 0
    total = 10
    demo_account = 'u_fc982587d85af44f.escrow.uprail.near'
    demo_pubkey = ''

    # 1. Escrow Sponsor Account (escrow.uprail.near)
    try:
        sys.stdout.write('[1/10] NEAR Mainnet Sponsor (escrow.uprail.near)... ')
        sys.stdout.flush()
        acc = call_rpc('query', {
            'request_type': 'view_account',
            'finality': 'final',
            'account_id': 'escrow.uprail.near'
        })
        near = int(acc['amount']) / 10**24
        print(f'✔ OK! Block #{acc["block_height"]} ({near:.4f} NEAR)')
        passed += 1
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 2. Deterministic User Sub-Account
    try:
        sys.stdout.write(f'[2/10] User Sub-Account ({demo_account})... ')
        sys.stdout.flush()
        call_rpc('query', {
            'request_type': 'view_account',
            'finality': 'final',
            'account_id': demo_account
        })
        keys = call_rpc('query', {
            'request_type': 'view_access_key_list',
            'finality': 'final',
            'account_id': demo_account
        })
        demo_pubkey = keys.get('keys', [{}])[0].get('public_key', '')
        if not demo_pubkey:
            raise Exception('No public key found')
        print(f'✔ OK! Key {demo_pubkey[:18]}...')
        passed += 1
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 3. NEAR Intents Contract & Key Registration (intents.near::has_public_key)
    try:
        sys.stdout.write('[3/10] NEAR Intents Key Registration (intents.near)... ')
        sys.stdout.flush()
        key_to_check = demo_pubkey or 'ed25519:FBgiyiswzZMo6faKtD4tRsRZqniUon3k1XcpzokKoCAR'
        args_b64 = base64.b64encode(json.dumps({
            'account_id': demo_account,
            'public_key': key_to_check
        }).encode()).decode()
        res = call_rpc('query', {
            'request_type': 'call_function',
            'finality': 'final',
            'account_id': 'intents.near',
            'method_name': 'has_public_key',
            'args_base64': args_b64
        })
        registered = json.loads(bytes(res['result']).decode())
        if registered is True:
            print('✔ OK! has_public_key == true')
            passed += 1
        else:
            print(f'✖ FAIL: has_public_key returned {registered}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 4. Production Worker Health
    try:
        sys.stdout.write('[4/10] Production Worker Health (api.uprail.world/health)... ')
        sys.stdout.flush()
        data = http_get('https://api.uprail.world/health')
        if data.get('status') == 'ok':
            print(f'✔ OK! {data.get("service")} v{data.get("version")}')
            passed += 1
        else:
            print(f'✖ FAIL: {data}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 5. Public @handle -> Vault Resolution
    try:
        sys.stdout.write('[5/10] Public Identity Resolver (@uprailworld)... ')
        sys.stdout.flush()
        data = http_get('https://api.uprail.world/api/resolve?handle=uprailworld')
        if data.get('resolved') and data.get('nearAccount') == demo_account:
            print(f'✔ OK! -> {data.get("nearAccount")}')
            passed += 1
        else:
            print(f'✖ FAIL: {data}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 6. Cross-Chain Token Registry & Live USD Price Oracle
    try:
        sys.stdout.write('[6/10] Cross-Chain Tokens & Live Price Oracle... ')
        sys.stdout.flush()
        toks = http_get('https://api.uprail.world/api/onchain/tokens')
        price = http_get('https://api.uprail.world/api/onchain/price?asset=wrap.near')
        count = len(toks.get('tokens', []))
        if count > 20 and isinstance(price.get('priceUsd'), (int, float)):
            print(f'✔ OK! {count} Intents tokens · NEAR=${price["priceUsd"]:.2f}')
            passed += 1
        else:
            print(f'✖ FAIL: tokens={count}, price={price}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 7. AI Agent OpenAPI 3.1.0 Spec
    try:
        sys.stdout.write('[7/10] AI Agent OpenAPI 3.1.0 Spec (/api/agent/openapi.json)... ')
        sys.stdout.flush()
        spec = http_get('https://api.uprail.world/api/agent/openapi.json')
        paths = list((spec.get('paths') or {}).keys())
        if spec.get('openapi', '').startswith('3.1') and len(paths) >= 4:
            print(f'✔ OK! {len(paths)} agent paths')
            passed += 1
        else:
            print(f'✖ FAIL: {spec.get("openapi")}, paths={paths}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 8. OAuth 2.1 + Remote MCP Protected Resource Discovery (RFC 8414 + RFC 9728)
    try:
        sys.stdout.write('[8/10] OAuth 2.1 & MCP Discovery (RFC 8414 / RFC 9728)... ')
        sys.stdout.flush()
        oauth = http_get('https://app.uprail.world/.well-known/oauth-authorization-server')
        mcp = http_get('https://api.uprail.world/.well-known/oauth-protected-resource/api/mcp')
        if oauth.get('authorization_endpoint') and mcp.get('resource'):
            print(f'✔ OK! MCP={mcp.get("resource")}')
            passed += 1
        else:
            print(f'✖ FAIL: oauth={oauth}, mcp={mcp}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 9. Launchpad Creator-Fee Routing Config
    try:
        sys.stdout.write('[9/10] Launchpad Creator-Fee Routing (/api/launchpads/config)... ')
        sys.stdout.flush()
        lp = http_get('https://api.uprail.world/api/launchpads/config')
        if lp.get('escrowAccount') == 'escrow.uprail.near' and lp.get('verificationKinds'):
            print(f'✔ OK! Kinds: {", ".join(lp["verificationKinds"])}')
            passed += 1
        else:
            print(f'✖ FAIL: {lp}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 10. Fail-Closed Auth / Anti-BAC Verification
    try:
        sys.stdout.write('[10/10] Fail-Closed Anti-BAC Guard (/api/payments)... ')
        sys.stdout.flush()
        code = http_status('https://api.uprail.world/api/payments')
        if code == 401:
            print('✔ OK! Unauthenticated access blocked (HTTP 401)')
            passed += 1
        else:
            print(f'✖ FAIL: Expected 401, got HTTP {code}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    print('\n-----------------------------------------------------------------')
    print(f'Verification Summary: {passed}/{total} checks passed.')
    print('-----------------------------------------------------------------\n')

    if passed == total:
        print('🎉 ALL ON-CHAIN SPONSOR, MAINNET & FEATURE CHECKS PASSED!\n')
        sys.exit(0)
    else:
        print('⚠️ Some checks failed. See details above.\n')
        sys.exit(1)

if __name__ == '__main__':
    main()
