# Maalow Admin — HANDOFF

> Read this first in a fresh session. This is the **separate admin tool**, not the mobile
> app. Companion: the mobile app lives in `../maalow-pro/` (its own repo + `HANDOFF.md`),
> and the two share ONE Supabase project.

---

## Repo & session state (as of 2026-08-07) — READ FIRST

> **2026-08-07 — this tool is UNCHANGED, still at `4d53327`, clean and pushed. No action
> needed here.** But the **shared database has moved on a lot** since this file was written,
> so read this before assuming the schema stops at `0003`.
>
> Migrations `0004`–`0008` were added by the mobile app and are **all applied live**:
> | Migration | Adds |
> |---|---|
> | `0004` | `trade_category` value `carpentry` |
> | `0005` | `city` enum + `trades.city`; `profiles.company` |
> | `0006` | `profiles.is_available_now`, `bookings.is_urgent` + a SECURITY DEFINER trigger |
> | `0007` | `trade_category` value `roadside_assistance` |
> | `0008` | rewrites `recompute_trade_rating` to scope ratings **per category** (+ backfill) |
>
> **Verified 2026-08-06 that none of this breaks the admin tool:** it selects **explicit
> column lists** (not `select *`), so additive columns can't affect it. All four of its
> queries return **200** against the current schema, the page boots with **zero console
> errors**, and supabase-js still loads from the CDN.
>
> ✅ **The `is_urgent` gap is CLOSED (2026-08-08)** — see §6 below. The `bookings` select now
> includes `is_urgent`, the table marks urgent rows, and the realtime banner says so.
> The same commit added the two missing `CATEGORY_LABELS` entries (`carpentry` from `0004`,
> `roadside_assistance` from `0007`), which were printing the raw enum value.
>
> ⚠️ **Unverified:** the populated dashboard/table rendering was **not** re-checked while
> signed in, because that needs the `is_admin` account's password. Only the login screen and
> the query shapes were verified. Sign in as an admin and eyeball the table to close this out.

## Earlier repo & session state (as of 2026-07-16)

| Field | Value |
|---|---|
| Folder | `maalow-pro-admin/` (sibling of `maalow-pro/`, NOT inside it) |
| GitHub repo | `github.com/diop6000/Maalow-namibia-pro-v2` |
| Branch / local HEAD | `main` / **`341523c`** ("Initial commit — Maalow Admin") + a HANDOFF docs commit on top |
| Pushed? | ✅ **Yes — pushed, 0 unpushed, clean working tree** |
| Secret handling | `config.js` (holds the anon key) is **gitignored**; only `config.example.js` is on GitHub |

> ⚠️ **Correction to a stale assumption:** this repo is *already created and pushed* to
> `Maalow-namibia-pro-v2`. An earlier note said it was "committed locally but not pushed,
> waiting for the repo URL" — that's out of date; the URL was provided and the push
> succeeded. Nothing is pending on the git side.

Shared backend: Supabase project `ozjzeqrjyqpxoyakuusz`. The admin schema (`is_admin`,
`payment_events`, admin RLS, realtime) comes from **`../maalow-pro/supabase/migrations/0003_admin_reconciliation.sql`**, which is **applied** to the live DB.

Current admin account: **`cheikhlaurent@hotmail.com`** (`is_admin = true`, promoted via SQL).

---

## 0. What this is

A lightweight, **standalone** web tool for the Maalow team to reconcile manual EasyWallet
payments: review all bookings, log payment events, watch a revenue/payout dashboard, and
get a live banner + beep the moment a client reports a transfer.

**Stack:** plain `index.html` + `app.js` + `styles.css`, `@supabase/supabase-js` loaded
from `https://esm.sh` (CDN). **No build step, no framework, no npm install.** Deliberately
minimal (single internal user, easy to serve/deploy/verify). Chosen over React/Vite on
purpose — see `../maalow-pro/DECISIONS.md` AD1.

**Files (6 tracked + 1 gitignored):**
```
index.html          login view + dashboard view (both in one page, toggled by `hidden`)
app.js              Supabase client, auth+admin gate, data load, event logging, realtime
styles.css          Maalow-palette styling
config.example.js   template (committed)
config.js           real SUPABASE_URL + anon key + COMMISSION_RATE  (GITIGNORED)
.gitignore          ignores config.js
README.md           setup/run/deploy
```

### Run it
```bash
cd maalow-pro-admin
cp config.example.js config.js     # then fill SUPABASE_URL + SUPABASE_ANON_KEY (already done locally)
npx serve . -l 5200                 # any static server works
# open http://localhost:5200, sign in with an is_admin account
```
(`config.js` already exists locally with the real values; a fresh clone must recreate it.)

---

## 1. What's FULLY WORKING (verified live end-to-end, 2026-07-16)

Driven through the real UI against the live DB as `cheikhlaurent@hotmail.com`:

- **Login + admin gate** — Supabase email/password. After login the app reads the caller's
  own `profiles.is_admin`; non-admins are signed out with *"This account is not authorized"*
  (UI convenience). The real boundary is **RLS** (see §2).
- **Dashboard** — Collected revenue, Commission (15%), Payouts pending, Payouts sent.
  Verified: after a booking went `paid`, showed Revenue N$435 / Commission N$65 /
  Pending N$370, and after logging *Payout sent* → Pending N$0 / Sent N$370.
- **Bookings table** — client, tradesperson, category, amount, payment status pill,
  scheduled date, the payment-event ledger, and a per-row **Log event** control
  (dropdown: *EasyWallet received* / *Payout sent* + optional note + Log button).
  Reads **all** bookings (admin RLS policy).
- **Log payment event** — inserts into `payment_events`; `actor_id` (`auth.uid()`) and
  `created_at` (`now()`) captured automatically by DB defaults. Verified: ledger showed
  *"EasyWallet received · … · Verified on MTC statement"* then *"Payout sent · …"*.
- **Realtime banner + audio** — subscribes to `bookings` UPDATE filtered to
  `payment_status = awaiting_confirmation`; on the transition, with **no refresh**, shows a
  banner (*"💸 Payment pending confirmation — Tomas Haufiku, N$ 435"*) + a WebAudio beep,
  then reloads the table/dashboard. Verified live. Zero console errors throughout.

---

## 2. Mocked vs Real

**There is NO mock/demo mode.** Unlike the mobile app (which has a demo fallback when
Supabase isn't configured), the admin tool **always** talks to the live Supabase project.
If `config.js` is missing/wrong or the account isn't an admin, it simply denies access —
it never shows fake data.

- **Reads (real):** `profiles` (all — existing RLS lets any authenticated user read
  profiles, used for names), `bookings` (all — via the admin "read all bookings" policy),
  `payment_events` (admin-only policy).
- **Writes (real):** `payment_events` inserts only.
- **Does NOT write** `bookings.payment_status` — that lifecycle stays in the mobile app
  (client → `awaiting_confirmation`, tradesperson → `paid`, guarded by the `0002` trigger).
  The admin tool is an **append-only audit ledger**, intentionally separate. There is no
  admin UPDATE policy on `bookings`, so it structurally cannot alter payment status.
- **Server-side security = RLS + the `is_admin()` function** (migration `0003`). The anon
  key in `config.js` is public-by-design; non-admins get nothing from the ledger/all-bookings
  even if they open the page. The in-page login check is convenience, not the boundary.
- **Placeholder:** `COMMISSION_RATE = 0.15` in `config.js` (dashboard math: payout =
  amount × (1 − rate); revenue = Σ paid bookings; commission = revenue × rate). Set the
  real rate when known.

---

## 3. The CSS login-visibility fix (just applied — in `341523c`)

**Symptom:** after a successful login, "nothing happened" — the login card stayed on
screen. **Cause:** `styles.css` had `.login-view { display: grid }`, which **overrode** the
HTML `hidden` attribute (`[hidden]{display:none}` from the UA stylesheet). So when the app
set `login-view.hidden = true` after login, the card kept displaying (as a full-viewport
grid) *on top of* the already-loaded dashboard. **Fix:** added

```css
[hidden] { display: none !important; }
```

near the top of `styles.css`, so the `hidden` attribute always wins. Verified: after login
`login-view` computes `display:none` and the dashboard shows alone. This fix is committed
in the initial commit `341523c` (already on GitHub).

---

## 4. Known issues / gotchas

- **`config.js` must exist in any deployed copy.** It's gitignored, so a clone/deploy has
  no `config.js` until you recreate it (copy from `config.example.js` + fill values, or
  inject at the host). Without it the page errors on the `import`.
- **`COMMISSION_RATE` is a placeholder** (0.15) — confirm the real business rate.
- **No admin-management UI.** Promote/demote is SQL-only:
  `update public.profiles set is_admin = true where id = (select id from auth.users where email = '…');`
  (run in the SQL editor; the `prevent_self_admin` trigger blocks doing it via the API).
- **Realtime prerequisites** (all satisfied by `0003`): `bookings` published to
  `supabase_realtime` + `replica identity full`. The beep needs the `AudioContext` unlocked
  by a user gesture — it's created on the login click, so it works; a backgrounded tab may
  have audio throttled by the browser (banner still shows).
- **CDN dependency:** supabase-js is pulled from `esm.sh` at runtime — needs internet and
  esm.sh availability. For a hardened deploy, vendor the library locally instead.
- **Test data:** live DB has leftover `@maalowtest.dev` rows from verification. Clean with
  `delete from auth.users where email like '%@maalowtest.dev';` (in the mobile app's DB).

---

## 5. Next 3 steps (admin tool)

1. **Deploy it to a static host** (Netlify/Cloudflare Pages/etc.) so admins can use it off
   this machine — currently only runs locally via `npx serve`. Remember to add `config.js`
   on the host (it's gitignored). Consider access control beyond RLS (e.g. a separate
   private deploy / basic auth), since the URL would be public even though data is
   RLS-protected.
2. **Business-correctness pass:** set the real `COMMISSION_RATE`, confirm the payout/revenue
   definitions match how Maalow actually pays out, and add practical dashboard affordances
   (date-range filter, a "seen"/dismiss state per banced booking, sort/search on the table).
3. **Notifications + admin management:** wire the **Supabase Database Webhook → Make.com**
   (step-by-step guide in `../maalow-pro/HANDOFF.md` §8) to alert the team on every new
   `awaiting_confirmation`; and add an in-tool way to promote/demote admins (currently
   SQL-only). Optionally vendor supabase-js locally to drop the CDN dependency.

---

## 6. Urgent bookings surfaced in reconciliation — 2026-08-08

Closes the gap both handoffs had flagged. Rationale in `../maalow-pro/DECISIONS.md` **AD10**.

| Change | Where |
|---|---|
| `is_urgent` added to the `bookings` select | `app.js` `loadData()` |
| **Urgent** chip beside the category | `app.js` `renderTable()` + `.chip-urgent` in `styles.css` |
| Scheduled cell prefixed **`ASAP · `** for urgent rows | `app.js` `renderTable()` |
| Realtime banner prefixed **`⚡ URGENT · `** | `app.js` `onPaymentPending()` |
| `carpentry` + `roadside_assistance` labels | `app.js` `CATEGORY_LABELS` |

The chip is deliberately **outlined**, not a filled pill, so it can never be mistaken for a
payment-status pill; its colour is `--urgent: #2E6C99`, the same trust-blue as the mobile
app's `UrgentBadge` (never green, never red — urgent means time-sensitive, not alarm).

**Verified (2026-08-08):** the page boots with **zero console errors**; the new select returns
**HTTP 200** against the live DB, and a control request with a bogus column returns
**400 / `42703`** — so the 200 proves `is_urgent` really is selectable, it isn't a silently
ignored field. The chip computes to `rgb(46, 108, 153)` on white with a matching border,
renders 60×20 inline in the Category cell, and the table does not overflow horizontally.

⚠️ **Still not verified while signed in** (unchanged from the note above): rendering against
*real* urgent rows needs the `is_admin` account's password. The markup and CSS were checked
with injected rows. Sign in once and eyeball a real ASAP booking to close this out.

---

## Quick reference

- **Migration that backs this tool:** `../maalow-pro/supabase/migrations/0003_admin_reconciliation.sql` (applied).
- **Judgment calls / rationale:** `../maalow-pro/DECISIONS.md` (AD1–AD9).
- **Supabase project ref:** `ozjzeqrjyqpxoyakuusz`.
- **This repo:** `github.com/diop6000/Maalow-namibia-pro-v2` @ `341523c` (pushed, clean).
