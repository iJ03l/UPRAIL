# UP frontend (Next.js)

Next.js 16 App Router, built as a **static export** and served by the Cloudflare
Worker from `worker/wrangler.jsonc` (`assets.directory = ../frontend/dist`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server on `:3000`; API/OAuth calls are rewritten to the Worker at `http://127.0.0.1:8787` |
| `npm run build` | `next build` (→ `out/`) then `copy-export` syncs `out/` → `dist/` |
| `npm run copy-export` | Only the `out/` → `dist/` sync (clean, so stale files are never served) |
| `npm run start` | Serve the export locally (`next start`, dev-only) |
| `npm run typecheck` | `tsc --noEmit` |

`npm run build` is the single command that produces everything the Worker needs.

## Constraints of the static export

- No server code: no Route Handlers with dynamic params, no `middleware.ts`, no
  server actions. Everything runs in the browser against same-origin `/api/*`.
- Deep links such as `/claim/<paymentId>` are rewritten by the Worker
  (`CLAIM_DEEP_LINK` in `worker/src/index.ts`) onto the static `/claim` page,
  which reads the id from the URL. Dynamic `[id]` routes do not exist.
- Routing goes through `src/lib/router.tsx`, a thin Next-native shim exposing
  the react-router API the views already use (`Link`, `useNavigate`,
  `useLocation`, `useSearchParams`, `Navigate`, `PageSuspense`).
- `src/app/protected/*` pages are wrapped in `components/ProtectedPage.tsx`
  (session + passkey checks); `components/DomainGate.tsx` decides which pages
  are allowed on the apex vs `app.` subdomain.

## State & storage

- Server data: fetched in `src/lib/api.ts` (`/api/*`) and `src/lib/onchainApi.ts`
  (`/api/onchain/*`), all with `credentials: 'include'`.
- Browser caches (`uprail_*` in `localStorage`) hold balances and pending
  payments. They are **tagged with the owning account id** and discarded when a
  different account signs in; `clearAppStorage()` wipes them on logout.

## Pricing

`tokenUsdPrice()` in `src/lib/api.ts` is the single place that turns a token
into a display price: live registry price, else `1` for stablecoins, else `0`.
Never invent a price — a made-up number silently corrupts every USD total.
