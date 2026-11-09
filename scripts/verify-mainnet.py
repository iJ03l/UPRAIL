#!/usr/bin/env python3
"""
UPRAIL: Live Mainnet & On-Chain Sponsor Verification Script

Zero-dependency verification for NEAR Hackathon judges & automated evaluators:
1. Verifies the escrow sponsor account on NEAR mainnet (escrow.uprail.near).
2. Verifies a deterministic user sub-account created by the escrow sponsor.
3. Verifies NEAR Intents contract (intents.near) availability.
4. Verifies UPRAIL API worker health & handle resolver.
5. Verifies OAuth 2.1 & Remote MCP protected resource metadata.
"""

import sys, json, urllib.request

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
            with urllib.request.urlopen(req, timeout=10) as res:
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
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode('utf-8'))

def main():
    print('===========================================================')
    print('⚡ UPRAIL: Live Mainnet & On-Chain Sponsor Verification')
    print('===========================================================\n')

    passed = 0
    total = 6

    # 1. Escrow Sponsor Account (escrow.uprail.near)
    try:
        sys.stdout.write('[1/6] Checking NEAR Mainnet Sponsor (escrow.uprail.near)... ')
        sys.stdout.flush()
        acc = call_rpc('query', {
            'request_type': 'view_account',
            'finality': 'final',
            'account_id': 'escrow.uprail.near'
        })
        yocto = int(acc['amount'])
        near = yocto / 10**24
        print(f'✔ OK! Active at block #{acc["block_height"]} (Balance: {near:.4f} NEAR)')
        passed += 1
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 2. User Sub-Account created via Escrow Sponsor
    try:
        sys.stdout.write('[2/6] Checking User Sub-Account (u_fc982587d85af44f.escrow.uprail.near)... ')
        sys.stdout.flush()
        acc = call_rpc('query', {
            'request_type': 'view_account',
            'finality': 'final',
            'account_id': 'u_fc982587d85af44f.escrow.uprail.near'
        })
        keys = call_rpc('query', {
            'request_type': 'view_access_key_list',
            'finality': 'final',
            'account_id': 'u_fc982587d85af44f.escrow.uprail.near'
        })
        pk = keys.get('keys', [{}])[0].get('public_key', 'unknown')
        print(f'✔ OK! Sub-account verified with key {pk[:16]}...')
        passed += 1
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 3. NEAR Intents Contract (intents.near)
    try:
        sys.stdout.write('[3/6] Checking NEAR Intents Contract (intents.near)... ')
        sys.stdout.flush()
        intents = call_rpc('query', {
            'request_type': 'view_account',
            'finality': 'final',
            'account_id': 'intents.near'
        })
        print(f'✔ OK! Verified contract code hash {intents["code_hash"][:12]}...')
        passed += 1
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 4. UPRAIL Production Worker Health
    try:
        sys.stdout.write('[4/6] Checking Live API Health (api.uprail.world/health)... ')
        sys.stdout.flush()
        data = http_get('https://api.uprail.world/health')
        if data.get('status') == 'ok':
            print(f'✔ OK! Service: {data.get("service")} v{data.get("version")}')
            passed += 1
        else:
            print(f'✖ FAIL: Unexpected {data}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 5. Public Identity Resolver (Mapping @handle to Vault)
    try:
        sys.stdout.write('[5/6] Resolving Handle (@uprailworld) -> Deterministic Vault... ')
        sys.stdout.flush()
        data = http_get('https://api.uprail.world/api/resolve?handle=uprailworld')
        if data.get('resolved') and data.get('nearAccount') == 'u_fc982587d85af44f.escrow.uprail.near':
            print(f'✔ OK! Resolved to {data.get("nearAccount")}')
            passed += 1
        else:
            print(f'✖ FAIL: Unexpected {data}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    # 6. OAuth 2.1 & Protected Resource Metadata for MCP
    try:
        sys.stdout.write('[6/6] Verifying OAuth 2.1 & MCP Protected Resource (RFC 9728)... ')
        sys.stdout.flush()
        data = http_get('https://api.uprail.world/.well-known/oauth-protected-resource/api/mcp')
        if data.get('resource') and isinstance(data.get('scopes_supported'), list):
            scopes = ', '.join(data.get('scopes_supported'))
            print(f'✔ OK! Resource: {data.get("resource")} ({scopes})')
            passed += 1
        else:
            print(f'✖ FAIL: Unexpected {data}')
    except Exception as e:
        print(f'✖ FAIL: {e}')

    print('\n-----------------------------------------------------------')
    print(f'Verification Summary: {passed}/{total} checks passed.')
    print('-----------------------------------------------------------\n')

    if passed == total:
        print('🎉 ALL ON-CHAIN SPONSOR & MAINNET CHECKS PASSED SUCCESSFULLY!\n')
        sys.exit(0)
    else:
        print('⚠️ Some checks failed. See details above.\n')
        sys.exit(1)

if __name__ == '__main__':
    main()
