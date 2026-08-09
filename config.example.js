// Copy this file to `config.js` and fill in your Supabase project values.
// The anon key is safe to expose in a client bundle (it's protected by RLS); admin access
// is enforced server-side by the is_admin flag + policies from migration 0003. `config.js`
// is gitignored so the key isn't committed, matching the main app's .env handling.
export const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';

// ⚠️ This is NO LONGER the commission rate. Since migration 0009 the rate is decided by the
// DATABASE at the moment a booking is paid, from that TRADESPERSON's own count of paid
// bookings, and frozen on the booking row:
//
//   their bookings  1–10  →  0%   (tier 0)
//   their bookings 11–30  →  6%   (tier 1)
//   their bookings 31+    → 12%   (tier 2)
//
// Changing the value below cannot change what any booking is charged — that is the point.
// The thresholds live in `commission_tier_for_position` / `commission_rate_for_tier`
// (migration 0009); moving them is a migration, not a config edit.
//
// COMMISSION_RATE is only the DISPLAY FALLBACK for a row with no stored rate — a booking
// paid before 0009, or any row read while 0009 isn't applied. It is deliberately the TOP
// tier so a missing rate over-reports rather than under-reports what is owed, and the panel
// labels every defaulted row so it can't be mistaken for a real one.
export const COMMISSION_RATE = 0.12;
