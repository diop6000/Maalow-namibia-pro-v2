// Copy this file to `config.js` and fill in your Supabase project values.
// The anon key is safe to expose in a client bundle (it's protected by RLS); admin access
// is enforced server-side by the is_admin flag + policies from migration 0003. `config.js`
// is gitignored so the key isn't committed, matching the main app's .env handling.
export const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';

// Platform commission taken from each collected booking (0.15 = 15%). Payout to the
// tradesperson = amount * (1 - COMMISSION_RATE). Placeholder — adjust to the real rate.
export const COMMISSION_RATE = 0.15;
