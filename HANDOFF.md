# Maalow Admin — HANDOFF

> Read this first in a fresh session. This is the **separate admin tool**, not the mobile
> app. Companion: the mobile app lives in `../maalow-pro/` (its own repo + `HANDOFF.md`),
> and the two share ONE Supabase project.
>
> **Decisions for THIS tool now live in [`DECISIONS.md`](DECISIONS.md) here** (AD16+).
> `AD1`–`AD15` predate it and remain in `../maalow-pro/DECISIONS.md` — notably **AD1**
> (why this tool is framework-free) and **AD5** (why `payment_events` is an audit ledger
> kept separate from `bookings.payment_status`).

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
- **Dashboard** — Collected revenue, Commission, Payouts pending, Payouts sent. (Commission
  was a flat 15% when this was verified; it is now per-booking and tiered — see §7.)
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
- **Commission (real, since migration `0009`):** the DB assigns each booking a rate when it
  is paid, from that tradesperson's own paid-booking count (**0% for 1–10, 6% for 11–30, 12%
  for 31+**), and freezes it on the row. The panel reads it; it never computes it.
  `COMMISSION_RATE` in `config.js` is now only the fallback for rows with no stored rate.
  Dashboard math: revenue = Σ paid bookings; commission = Σ (each booking × **its own**
  rate); payout = amount − that booking's commission. See §7.

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
- **`COMMISSION_RATE` no longer sets what anyone is charged** (migration `0009` does) — but
  it still lives in the gitignored `config.js`, so each deployed copy has its own. A stale
  one only affects how rows *with no stored rate* are displayed, not the money itself.
- **No admin-management UI.** Promote/demote is SQL-only:
  `update public.profiles set is_admin = true where id = (select id from auth.users where email = '…');`
  (run in the SQL editor; the `prevent_self_admin` trigger blocks doing it via the API).
- **Realtime prerequisites** (all satisfied by `0003`): `bookings` published to
  `supabase_realtime` + `replica identity full`. The beep needs the `AudioContext` unlocked
  by a user gesture — it's created on the login click, so it works; a backgrounded tab may
  have audio throttled by the browser (banner still shows).
- **CDN dependency:** supabase-js is pulled from `esm.sh` at runtime — needs internet and
  esm.sh availability. For a hardened deploy, vendor the library locally instead.
- **Test data:** live DB has leftover `@maalowtest.dev` rows from verification, including
  **33 throwaway bookings** from the 2026-08-08 urgent-badge and commission-tier checks.
  Clean all of it with `delete from auth.users where email like '%@maalowtest.dev';`, or just
  the 2026-08-08 rows with:
  ```sql
  delete from auth.users where email in (
    'urgent-badge-client@maalowtest.dev', 'urgent-badge-pro@maalowtest.dev',
    'tier-check-client@maalowtest.dev',   'tier-check-pro@maalowtest.dev');
  ```
  (`profiles` cascades from `auth.users`; `trades`/`bookings` cascade from `profiles`.)
  ⚠️ Until deleted, those 31 paid bookings inflate the dashboard by N$ 3 100 revenue /
  N$ 132 commission.

---

## 5. Next 3 steps (admin tool)

1. ~~**Deploy it to a static host**~~ — **DONE 2026-08-14.** Live at
   **https://maalow-admin-na.netlify.app** (Netlify project `maalow-admin-na`,
   id `e22a50c5-0ab4-4b6a-8571-e7cb863e69a6`). See §8 for how to redeploy — there are two
   traps. **Access control is RLS only, deliberately** — see `../maalow-pro/DECISIONS.md`
   **AD15**: Netlify password protection needs the Pro plan ($20/mo), and "Private" on the
   current Free team would lock everyone but the Team Owner out rather than gate them in.
   Revisit when real customer data justifies the cost; prefer a separate Netlify team over a
   shared password at that point.
2. **Business-correctness pass:** confirm the payout/revenue definitions match how Maalow
   actually pays out, decide the Phase-1 retroactivity question (§7), and add practical
   dashboard affordances (date-range filter, a "seen"/dismiss state per banner booking,
   sort/search on the table).
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

## 7. Tiered commission — 2026-08-08

> An earlier version of this section described a flat `COMMISSION_RATE` you bumped by hand
> (Phase 0 = 0%). **That is gone.** The rate is now decided by the database per booking.
> Rationale in `../maalow-pro/DECISIONS.md` **AD12–AD14**.

Each booking is charged according to how many bookings **that tradesperson** has already
been paid for. The rate is decided at the moment the booking is marked paid and **frozen on
the row**, so crossing a tier never re-prices history.

| Tier | That pro's paid bookings | Rate |
|---|---|---|
| 0 | 1–10 | 0% |
| 1 | 11–30 | 6% |
| 2 | 31+ | 12% |

**Where the logic lives:** `supabase/migrations/0009_commission_tiers.sql` in the mobile-app
repo — `commission_tier_for_position` / `commission_rate_for_tier` (the thresholds) and the
`bookings_set_commission_on_paid` trigger. **Changing the tiers is a migration, not a config
edit** — that is deliberate (AD13). The trigger also blocks either party from rewriting a
stored rate through the API.

**What this panel does with it:** selects `commission_rate` + `commission_tier`, shows a
per-booking **Commission** column (amount, rate, `T0/T1/T2`), and sums the dashboard's
commission total **per booking from each row's own rate** — never one blended rate applied to
total revenue, which would be wrong the moment two pros sit in different tiers. The card's
sub-line reports the blended rate as an *outcome*. Payout per booking is the remainder
(`amount − commission`), not `amount × (1 − rate)`, so rounding always reconciles.

⚠️ **`COMMISSION_RATE` in `config.js` is no longer the rate.** It is only the display
fallback for a row with no stored rate, and it is set to the **top** tier (`0.12`) on purpose
so a missing rate over-reports rather than under-reports. Rows using it are labelled
`default` in the table and counted in the commission card's sub-line.

**Pre-migration behaviour:** if `0009` isn't applied, the commission columns don't exist and
PostgREST fails the *whole* select with `42703` — which would blank the table. The panel
retries without those columns, falls back to the default rate, and says so in a warning above
the table. Verified: the pre-migration error really is `42703`.

### Verified live — 2026-08-08, migration applied

One throwaway tradesperson taken through **31 bookings**, each driven
`unpaid → awaiting_confirmation → paid` in order. Every boundary landed correctly and
**0 of 31 mismatched**:

| Position | Tier | Stored rate |
|---|---|---|
| 1, 9, **10** | 0 | `0.000` |
| **11**, 12, 29, **30** | 1 | `0.060` |
| **31** | 2 | `0.120` |

Distribution: 10 rows tier 0 · 20 tier 1 · 1 tier 2.

**The stored rates make a real difference to the dashboard** — on that data (N$ 3 100
revenue) the per-booking sum is **N$ 132** commission (4.3% blended, N$ 2 968 payouts),
where the old flat-constant code would have reported **N$ 372** at the 12% default:
**N$ 240 overstated**.

**Tamper attempt:** as the *client*, `PATCH commission_rate = 0` on the tier-1 booking
returned HTTP 200 and the stored rate was **still `0.060`** afterwards. The trigger's
else-branch silently restores the value rather than raising — the write appears to succeed
and simply has no effect. Worth knowing if you ever debug a "why didn't my update stick".

---

## 8. Deploy — 2026-08-14

Live: **https://maalow-admin-na.netlify.app** · project `maalow-admin-na` ·
id `e22a50c5-0ab4-4b6a-8571-e7cb863e69a6`.

**Two traps, both easy to hit:**

1. **This folder is linked to the WRONG Netlify project.** A `netlify.toml` at the repo root
   makes the CLI resolve the working directory to `maalow-transport` (a different app). A
   bare `netlify deploy --prod` from here would overwrite it. **Always pass `--site` explicitly.**
2. **Deploy a staged copy, not this folder.** `HANDOFF.md`, `README.md` and
   `config.example.js` would otherwise be served publicly — they document the schema, the
   project ref and the known gaps. Copy only the four runtime files.

```bash
mkdir -p /tmp/admin-deploy && cp index.html app.js styles.css config.js /tmp/admin-deploy/
npx netlify deploy --prod --dir=/tmp/admin-deploy --site e22a50c5-0ab4-4b6a-8571-e7cb863e69a6 --no-build
```

`config.js` is gitignored, so it is **not** in the repo and a fresh clone must recreate it
from `config.example.js` before deploying, or the page dies on the `import`.

The deploy adds a `netlify.toml` with `X-Robots-Tag: noindex`, `X-Frame-Options: DENY` and
`Referrer-Policy: no-referrer` — the panel should not be indexed or framed.

**Verified live:** login card renders, `config.js` loads the right project (`ozjzeqrjyqpxoyakuusz`),
all nine table headers present including **Commission**, zero console errors. Unknown paths
fall back to `index.html` — so the docs are genuinely absent, not merely unlinked.

### Promoting an admin
The in-tool gate reads `profiles.is_admin`; the real boundary is the `0003` RLS policies. The
`prevent_self_admin` trigger blocks promotion via the API, so it is SQL-editor only — see the
Quick reference below.

---

## 9. Duplicate payment events — 2026-09-02

Rationale in [DECISIONS.md](DECISIONS.md) **AD16–AD18**.

**Was:** logging the same `event_type` twice for one booking succeeded **silently**. The live data
still shows it — one booking carries three `EasyWallet received` and two `Payout sent` entries from
a single session. Two `Payout sent` rows read exactly like a tradesperson paid twice, and nothing
in the ledger distinguishes that from a double-click.

**Now:** `logControl(bookingId, events)` checks the booking's ledger for the selected type and, if
found, asks before inserting:

> `EasyWallet received was already logged at 04 Sept 2026, 05:00 — log it again?`

**It confirms, it does not block** — genuine repeats exist (a second partial transfer, a re-sent
payout), and an audit ledger that refuses to record what happened is worse than one that records
too much. Same principle as AD5: this table records, the DB trigger enforces.

Covers both event types automatically (keyed off the dropdown value, not hardcoded). The check
runs *before* the button is disabled, so cancelling leaves the control usable — the old code
relied on `loadData()` re-rendering, which never happens on a cancel.

### ⚠️ `confirm()` blocks browser automation — know this before testing

A native dialog **freezes the renderer**. During verification, every automated command —
screenshots, clicks, input — timed out until the dialog was dismissed by hand, and the dialog
itself is browser chrome that screenshots do not capture. Automating this tool means driving that
dialog through a CDP dialog handler, or accepting that the duplicate path needs a human click.
Deliberate trade for a two-person internal tool (AD17).

### Verified live — and the one branch that was not

Signed in as a real `is_admin` account against live data: first log on an empty ledger → no
dialog ✅ · same type again → dialog fires ✅ · abandoned → nothing written ✅ · **different type,
same booking → no dialog, no freeze, badge and summary cards updated** ✅ · **confirm through the
dialog → logs anyway** ✅.

Two results carry the most weight. The different-type check: same button, same row, same click
sequence — freezing on a duplicate and passing straight through on a new type. And the OK branch,
**observed live by a manual click** — a 3rd `EasyWallet received` badge appeared on the Test 2
Plombier row. Both branches are exercised: cancel writes nothing, OK writes the event.

The OK branch had to be pressed by hand. Automation can prove the dialog opens (the renderer
freeze is the evidence) but cannot press its buttons (AD17) — so this path is not
script-regression-testable.

### Deployed — 2026-09-18
The guard (`9b3ca72`) is **live on https://maalow-admin-na.netlify.app** (deploy
`6aad43aefc3fafed2a99be66`). Until then it had only run on `localhost:5200`. Deployed with the §8
staged-copy command (four runtime files, `--site` explicit). Netlify re-uploaded only `app.js`;
the other three files were unchanged by hash.

**Verified against the served file, not the CLI exit code:** the live `app.js` (production URL and
unique deploy URL, cache-busted) returned HTTP 200 and 17,664 bytes, contains
`was already logged at` (1 match), and is **byte-identical** to `app.js` at HEAD (same sha256).
`styles.css` and `config.js` are byte-identical, and `config.js` points at `ozjzeqrjyqpxoyakuusz`.
`index.html` differs only by Netlify's own injected comment, meta tags and HUD script.
`/HANDOFF.md` still falls back to `index.html`, so the docs are not served.

### ⚠️ The security headers in §8 are NOT live
§8 says the deploy adds `X-Robots-Tag: noindex`, `X-Frame-Options: DENY` and
`Referrer-Policy: no-referrer`. **The live responses carry none of them**, before or after this
deploy. The documented command stages only the four runtime files, so no header config reaches
Netlify. (A `netlify.toml` inside `--dir` is not read for headers; a `_headers` file in the
published dir would be.) Not changed in this deploy. **Open item — needs a decision.**

### Test rows from the 2026-09-02 verification — CLOSED
The `payment_events` rows logged while verifying this guard (`easywallet_received` and
`payout_sent` on kyc.check's N$5,021 booking) were **deleted manually in the SQL Editor** by the
owner. Nothing is pending here.

---

## Quick reference

- **Migration that backs this tool:** `../maalow-pro/supabase/migrations/0003_admin_reconciliation.sql` (applied).
- **Judgment calls / rationale:** `../maalow-pro/DECISIONS.md` (AD1–AD9).
- **Supabase project ref:** `ozjzeqrjyqpxoyakuusz`.
- **This repo:** `github.com/diop6000/Maalow-namibia-pro-v2` — `main`, pushed. Last admin deploy: 2026-09-18 (§9).
