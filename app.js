// Maalow Admin — payment reconciliation. Standalone static app (no build step): Supabase
// JS client from a CDN, vanilla DOM. Admin access is enforced server-side by the is_admin
// flag + RLS from migration 0003; the UI gate here is a convenience, not the security.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, COMMISSION_RATE } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Keep in sync with `trade_category` in the DB. `carpentry` came from migration 0004 and
// `roadside_assistance` from 0007 — without them those rows printed the raw enum value.
const CATEGORY_LABELS = {
  plumbing: 'Plumbing', electrical: 'Electrical', painting: 'Painting',
  ac: 'AC', handyman: 'Handyman', cleaning: 'Cleaning',
  carpentry: 'Carpentry', roadside_assistance: 'Auto Assistance',
};
const EVENT_LABELS = {
  easywallet_received: 'EasyWallet received',
  payout_sent: 'Payout sent',
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const loginView = $('login-view'), appView = $('app-view');
const loginForm = $('login-form'), loginBtn = $('login-btn'), loginError = $('login-error');

let profilesById = {};        // id -> full_name
let realtimeChannel = null;
let commissionColumnsMissing = false;  // true until migration 0009 is applied

// ── Commission ────────────────────────────────────────────────────────────────
// The rate is decided BY THE DATABASE at the moment a booking is paid (migration 0009,
// per-tradesperson tiers 0% / 6% / 12%) and frozen on the row. This panel only reads it —
// editing COMMISSION_RATE cannot change what any booking was charged.
//
// COMMISSION_RATE is the fallback for rows with no stored rate: pre-0009 bookings, or any
// row seen while the migration hasn't been applied yet. It is set to the top tier so a
// missing rate can never under-report what is owed.
const rateOf = (b) => (b.commission_rate == null ? COMMISSION_RATE : Number(b.commission_rate));
const isDefaultedRate = (b) => b.commission_rate == null;
const commissionCentsOf = (b) => Math.round(b.price_nad_cents * rateOf(b));
const fmtPct = (rate) => `${+(rate * 100).toFixed(1)}%`;

const BOOKING_COLS =
  'id, client_id, tradesperson_id, category, price_nad_cents, payment_status, status, scheduled_at, created_at, is_urgent';
const BOOKING_COLS_WITH_COMMISSION = `${BOOKING_COLS}, commission_rate, commission_tier`;

// ── Formatting ─────────────────────────────────────────────────────────────────
const fmtNAD = (cents) =>
  'N$ ' + ((cents ?? 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const nameOf = (id) => profilesById[id] || '—';

// ── View switching ───────────────────────────────────────────────────────────
function showLogin(msg) {
  appView.hidden = true; loginView.hidden = false;
  loginError.textContent = msg || '';
  loginBtn.disabled = false;
}
function showApp(email) {
  loginView.hidden = true; appView.hidden = false;
  $('who').textContent = email;
}

// ── Auth + admin gate ──────────────────────────────────────────────────────────
async function bootstrap() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await enterAdmin(session.user); else showLogin();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginBtn.disabled = true; loginError.textContent = '';
  ensureAudio(); // unlock audio on this user gesture so realtime beeps can play later
  const { data, error } = await supabase.auth.signInWithPassword({
    email: $('email').value.trim(), password: $('password').value,
  });
  if (error) { showLogin(error.message); return; }
  await enterAdmin(data.user);
});

async function enterAdmin(user) {
  // Server-side truth: can this account read its own is_admin AND is it true?
  const { data: profile, error } = await supabase
    .from('profiles').select('is_admin').eq('id', user.id).single();
  if (error) {
    // e.g. column missing (migration 0003 not applied) or network — deny safely.
    await supabase.auth.signOut();
    showLogin(`Could not verify admin access: ${error.message}`);
    return;
  }
  if (!profile?.is_admin) {
    await supabase.auth.signOut();
    showLogin('This account is not authorized for the admin panel.');
    return;
  }
  showApp(user.email);
  await loadData();
  subscribeRealtime();
}

$('signout-btn').addEventListener('click', async () => {
  if (realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
  await supabase.auth.signOut();
  showLogin();
});
$('refresh-btn').addEventListener('click', () => loadData());

// ── Data ────────────────────────────────────────────────────────────────────────
// Tolerate the pre-0009 window: if the commission columns don't exist yet, PostgREST
// answers the whole select with 42703, which would blank the entire table. Retry without
// them and fall back to COMMISSION_RATE, flagging it in the UI so nobody reads a defaulted
// figure as a real one.
async function fetchBookings() {
  const query = (cols) =>
    supabase.from('bookings').select(cols).order('created_at', { ascending: false });

  const res = await query(BOOKING_COLS_WITH_COMMISSION);
  if (res.error && res.error.code === '42703') {
    commissionColumnsMissing = true;
    return query(BOOKING_COLS);
  }
  commissionColumnsMissing = false;
  return res;
}

async function loadData() {
  $('table-status').textContent = 'Loading…';
  const [profilesRes, bookingsRes, eventsRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name'),
    fetchBookings(),
    supabase.from('payment_events')
      .select('booking_id, event_type, note, actor_id, created_at')
      .order('created_at', { ascending: false }),
  ]);

  const err = profilesRes.error || bookingsRes.error || eventsRes.error;
  if (err) { $('table-status').textContent = `Error loading data: ${err.message}`; $('bookings-body').innerHTML = ''; return; }

  profilesById = Object.fromEntries((profilesRes.data || []).map((p) => [p.id, p.full_name]));
  const bookings = bookingsRes.data || [];
  const eventsByBooking = {};
  for (const ev of (eventsRes.data || [])) (eventsByBooking[ev.booking_id] ||= []).push(ev);

  renderSummary(bookings, eventsByBooking);
  renderTable(bookings, eventsByBooking);
  $('table-status').textContent = commissionColumnsMissing
    ? `⚠️ Migration 0009 is not applied — no per-booking commission is stored, so every rate below is the ${fmtPct(COMMISSION_RATE)} default, not what was actually charged.`
    : '';
  $('row-count').textContent = `${bookings.length} booking${bookings.length === 1 ? '' : 's'}`;
}

// ── Summary dashboard ────────────────────────────────────────────────────────
// Commission is summed PER BOOKING from each row's own stored rate — a single blended rate
// applied to total revenue would be wrong the moment two tradespeople sit in different tiers.
function renderSummary(bookings, eventsByBooking) {
  let revenue = 0, commission = 0, payoutSent = 0, payoutPending = 0;
  let paidCount = 0, awaitingCount = 0, defaultedCount = 0;

  for (const b of bookings) {
    if (b.payment_status === 'awaiting_confirmation') awaitingCount++;
    if (b.payment_status === 'paid') {
      paidCount++;
      if (isDefaultedRate(b)) defaultedCount++;
      revenue += b.price_nad_cents;

      const commissionCents = commissionCentsOf(b);
      commission += commissionCents;
      // Payout is the remainder, not amount × (1 − rate): the two can differ by a cent
      // after rounding, and the remainder is the figure that actually reconciles.
      const payout = b.price_nad_cents - commissionCents;
      const sent = (eventsByBooking[b.id] || []).some((e) => e.event_type === 'payout_sent');
      if (sent) payoutSent += payout; else payoutPending += payout;
    }
  }

  $('m-revenue').textContent = fmtNAD(revenue);
  $('m-revenue-sub').textContent = `${paidCount} paid booking${paidCount === 1 ? '' : 's'}`;
  $('m-commission').textContent = fmtNAD(commission);
  $('m-commission-sub').textContent = commissionSubLabel(revenue, commission, defaultedCount);
  $('m-pending').textContent = fmtNAD(payoutPending);
  $('m-pending-sub').textContent = `${awaitingCount} awaiting client confirmation`;
  $('m-sent').textContent = fmtNAD(payoutSent);
}

// The blended rate is reported, never used as an input — it is an outcome of the mix of
// tiers, so it drifts as tradespeople cross thresholds.
function commissionSubLabel(revenue, commission, defaultedCount) {
  if (revenue === 0) return 'tiered per tradesperson';
  const blended = `${fmtPct(commission / revenue)} blended`;
  return defaultedCount === 0
    ? blended
    : `${blended} · ${defaultedCount} at the ${fmtPct(COMMISSION_RATE)} default`;
}

// ── Bookings table ───────────────────────────────────────────────────────────
function renderTable(bookings, eventsByBooking) {
  const body = $('bookings-body');
  body.innerHTML = '';
  if (bookings.length === 0) { $('table-status').textContent = 'No bookings yet.'; return; }

  for (const b of bookings) {
    const events = eventsByBooking[b.id] || [];
    const tr = document.createElement('tr');
    if (b.payment_status === 'awaiting_confirmation') tr.className = 'row-pending';

    tr.innerHTML = `
      <td class="name">${esc(nameOf(b.client_id))}</td>
      <td>${esc(nameOf(b.tradesperson_id))}</td>
      <td>${CATEGORY_LABELS[b.category] || esc(b.category)}${b.is_urgent ? ' <span class="chip-urgent">Urgent</span>' : ''}</td>
      <td class="num amount">${fmtNAD(b.price_nad_cents)}</td>
      <td class="num">${commissionCellHtml(b)}</td>
      <td><span class="pill ${b.payment_status}">${statusLabel(b.payment_status)}</span></td>
      <td>${b.is_urgent ? 'ASAP · ' : ''}${fmtDate(b.scheduled_at)}</td>
      <td>${ledgerHtml(events)}</td>
      <td></td>`;
    tr.lastElementChild.appendChild(logControl(b.id, events));
    body.appendChild(tr);
  }
}

// An unpaid booking owes nothing yet, so it shows "—" rather than a rate it might not get:
// the tier is only decided at the moment of payment, and the tradesperson may cross a
// threshold before then. A defaulted rate is marked so it can't be mistaken for a real one.
function commissionCellHtml(b) {
  if (b.payment_status !== 'paid') return '<span class="ledger-empty">—</span>';
  const rateLabel = fmtPct(rateOf(b));
  const tierNote = isDefaultedRate(b)
    ? ` <span class="rate-default" title="No rate stored on this booking — showing the config default">default</span>`
    : ` <span class="muted rate-tier">T${b.commission_tier}</span>`;
  return `${fmtNAD(commissionCentsOf(b))}<br><span class="muted rate-pct">${rateLabel}</span>${tierNote}`;
}

function statusLabel(s) {
  return s === 'awaiting_confirmation' ? 'Pending confirmation' : s === 'paid' ? 'Paid' : 'Unpaid';
}
function ledgerHtml(events) {
  if (!events.length) return '<span class="ledger-empty">—</span>';
  return '<div class="ledger">' + events.map((e) =>
    `<span class="badge"><b>${EVENT_LABELS[e.event_type]}</b> · ${fmtDate(e.created_at)}${e.note ? ' · ' + esc(e.note) : ''}</span>`
  ).join('') + '</div>';
}

// A per-row "log event" control: dropdown + optional note + button.
//
// `events` is THIS booking's ledger. `loadData` orders payment_events by created_at
// descending, so the first entry matching a type is the most recent occurrence of it.
function logControl(bookingId, events) {
  const wrap = document.createElement('div');
  wrap.className = 'logbox';
  const sel = document.createElement('select');
  sel.innerHTML = `<option value="easywallet_received">EasyWallet received</option>
                   <option value="payout_sent">Payout sent</option>`;
  const note = document.createElement('input');
  note.type = 'text'; note.placeholder = 'note (optional)'; note.maxLength = 200;
  const btn = document.createElement('button');
  btn.textContent = 'Log';
  btn.addEventListener('click', async () => {
    // Duplicate guard. Logging the same event_type twice for one booking used to succeed
    // silently — no warning, two identical ledger rows, and a payout that looks like it
    // happened twice.
    //
    // It CONFIRMS rather than blocks, on purpose. `payment_events` is an append-only audit
    // ledger: a genuine repeat exists (a second partial transfer, a re-sent payout), and the
    // ledger's job is to record what happened, not to decide what is allowed. Blocking here
    // would make the audit trail lie by omission. Same principle as the mobile app's AD5 —
    // the ledger stays deliberately separate from enforcement.
    //
    // Checked BEFORE the button is disabled, so cancelling leaves the control usable.
    const prior = events.find((e) => e.event_type === sel.value);
    if (prior) {
      const ok = confirm(
        `${EVENT_LABELS[sel.value]} was already logged at ${fmtDate(prior.created_at)} — log it again?`,
      );
      if (!ok) return;
    }

    btn.disabled = true; btn.textContent = '…';
    await logEvent(bookingId, sel.value, note.value.trim());
    // loadData() re-renders, so no need to reset this (now-detached) node.
  });
  wrap.append(sel, note, btn);
  return wrap;
}

// actor_id + created_at are captured automatically by DB defaults (auth.uid(), now()).
async function logEvent(bookingId, eventType, note) {
  const { error } = await supabase.from('payment_events')
    .insert({ booking_id: bookingId, event_type: eventType, note: note || null });
  if (error) { alert(`Could not log event: ${error.message}`); await loadData(); return; }
  await loadData();
}

// ── Realtime: live banner + audio when a booking moves to awaiting_confirmation ─
function subscribeRealtime() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel('admin-payment-pending')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'bookings', filter: 'payment_status=eq.awaiting_confirmation' },
      (payload) => {
        // Only alert on the actual transition INTO awaiting (ignore repeat updates).
        if (payload.old && payload.old.payment_status === 'awaiting_confirmation') return;
        onPaymentPending(payload.new);
      })
    .subscribe();
}

function onPaymentPending(booking) {
  const client = nameOf(booking.client_id);
  // REPLICA IDENTITY FULL (migration 0003) means the payload carries every column, so the
  // urgent flag is available here too — worth saying, since an ASAP job is time-sensitive.
  const urgent = booking.is_urgent ? '⚡ URGENT · ' : '';
  showBanner(`${urgent}💸 Payment pending confirmation — ${client}, ${fmtNAD(booking.price_nad_cents)}`);
  beep();
  loadData(); // refresh table + dashboard so the new pending row appears
}

function showBanner(text) {
  $('banner-text').textContent = text;
  $('banner').hidden = false;
}
$('banner-dismiss').addEventListener('click', () => { $('banner').hidden = true; });

// ── Audio alert (WebAudio, no asset) ───────────────────────────────────────────
let audioCtx = null;
function ensureAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* audio unavailable — banner still shows */ }
}
function beep() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [880, 1175].forEach((freq, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    const t = now + i * 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + 0.2);
  });
}

// ── util ────────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

bootstrap();
