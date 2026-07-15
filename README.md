# Maalow Admin — Payment Reconciliation

A small, standalone web tool (separate from the Expo/RN app) for the Maalow team to
reconcile manual EasyWallet payments: review bookings, log payment events (EasyWallet
received / Payout sent), watch a live dashboard, and get a real-time banner + beep the
moment a client marks a transfer as made.

**Stack:** plain HTML/CSS/JS, `@supabase/supabase-js` from a CDN. **No build step.**

## Setup

1. Apply **`../maalow-pro/supabase/migrations/0003_admin_reconciliation.sql`** in the
   Supabase SQL editor (adds `is_admin`, `payment_events`, admin RLS, realtime).
2. `cp config.example.js config.js` and fill in `SUPABASE_URL` + `SUPABASE_ANON_KEY`
   (the anon key is public-by-design; `config.js` is gitignored). Adjust `COMMISSION_RATE`.
3. **Promote an admin** — the person signs up a normal account (via the RN app or any
   Supabase auth signup), then in the SQL editor:
   ```sql
   update public.profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   ```
4. Serve the folder: `npx serve . -l 5200` (any static server works), open the URL, sign in.

## What it does

- **Login** — Supabase email/password. Non-admin accounts are rejected (UI check + RLS).
- **Dashboard** — collected revenue, commission, payouts pending vs sent.
- **Bookings table** — client, tradesperson, category, amount, payment status, schedule,
  the payment-event ledger, and a per-row "log event" control (dropdown + optional note).
  `actor_id` and `created_at` are captured automatically (DB defaults `auth.uid()` / `now()`).
- **Realtime** — subscribes to `bookings` UPDATEs where `payment_status = awaiting_confirmation`;
  shows a live banner + a short beep (no refresh) when a client reports a transfer.

## Deploy

It's static — deploy the folder to Netlify/any static host. Make sure `config.js` exists
in the deployed copy (it's gitignored, so add it in the host or via an env-injection step).

## Security notes

- Admin data is protected **server-side** by RLS (`is_admin` + policies in 0003), so the
  public anon key is safe. The UI gate is convenience, not the boundary.
- Users cannot self-promote: a trigger blocks changing `is_admin` except via service_role.
- The tool only **reads** bookings and **writes** `payment_events`; it never changes a
  booking's `payment_status` (that stays with the client/tradesperson flow in the RN app).
