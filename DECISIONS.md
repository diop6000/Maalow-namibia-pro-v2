# Maalow Admin — Decisions log

Judgment calls made in **this repo** (the standalone reconciliation tool), with rationale.
Newest first.

> **Where the earlier admin decisions live.** `AD1`–`AD15` predate this file and are recorded in
> the sibling app repo, `../maalow-pro/DECISIONS.md` — including **AD1** (why this tool is
> framework-free) and **AD5** (why `payment_events` is an audit ledger kept separate from
> `bookings.payment_status`). Those stay where they are; **new admin-tool decisions land here.**
> The numbering continues the same series so a reference to "AD16" is unambiguous.

---

## 2026-09-02 — Duplicate payment events

### AD16 — Confirm on a repeat event, do not block it
**The problem.** Logging the same `event_type` twice for one booking succeeded **silently** — no
warning, no visual difference, two identical rows in the ledger. Reproduced live before this
change, and the live data still carries the evidence: one booking holds **three**
`EasyWallet received` entries at 09:31 and **two** `Payout sent`, from a single session of
double-clicking.

That is worse than an ordinary duplicate-record bug, because of what this table is used for.
`payment_events` is the audit trail for money that moves **outside** the app — manual EasyWallet
transfers reconciled by hand. Two `Payout sent` rows for one booking read exactly like a
tradesperson who was paid twice. Nobody can tell from the ledger whether that happened or whether
someone clicked Log twice.

**The fix, and the line it does not cross.** Before inserting, the control looks for an existing
event of the same type on that booking and, if it finds one, asks:

> `EasyWallet received was already logged at 04 Sept 2026, 05:00 — log it again?`

**It confirms; it does not block.** Genuine repeats exist — a second partial transfer, a payout
re-sent after a failed first attempt — and an audit ledger that refuses to record what actually
happened is worse than one that records too much. Blocking would make the trail lie by omission.
This is the same principle as **AD5**: the ledger's job is to record, not to enforce. Enforcement
of the booking's own `payment_status` lives in the database trigger (`0002`, extended by `0015`),
deliberately separate from this table.

**Why the timestamp cannot drift.** The dialog and the ledger badge render the same expression
against the same object — `fmtDate(<that event>.created_at)`, from the same array the row is drawn
from. There is no second code path that could recompute or reformat it, so "shows the correct
prior timestamp" holds by construction rather than by testing.

**Implementation notes.**
- `logControl(bookingId, events)` now takes the booking's ledger. `renderTable` already had
  `events` in scope at the call site, so nothing extra is fetched.
- `loadData` orders `payment_events` by `created_at` descending, so the **first** match is the
  most recent occurrence — that is the one worth quoting back.
- The check runs **before** the button is disabled. The previous code relied on `loadData()`
  re-rendering to reset the button, which never happens when the user cancels.
- Keyed off `sel.value`, so it covers `easywallet_received` and `payout_sent` without naming
  either — a third event type would be covered automatically.

### AD17 — `confirm()` stays, and it blocks browser automation
A native `confirm()` was kept over a styled in-page modal. This tool is deliberately
framework-free for an audience of two (AD1); a custom modal is more code and more surface for zero
functional gain, and `logEvent` already uses `alert()` for errors, so the idiom is consistent.

⚠️ **Known consequence, demonstrated not theorised:** a native dialog **freezes the renderer**, so
CDP-driven browser automation cannot get past it. During verification, clicking Log on a duplicate
made every subsequent automated command — screenshots, clicks, input — time out until the dialog
was dismissed by hand, and the dialog itself is browser chrome that screenshots do not capture.

Anything automating this tool must either drive that dialog through a CDP dialog handler or accept
that the duplicate path needs a human click. That is an acceptable trade for a two-person internal
tool; it would not be for a user-facing one.

The OK branch was ultimately closed exactly that way — **by hand** — see AD18. Automation could
confirm the dialog *opens* (the freeze is the evidence) but never that pressing OK proceeds.

### AD18 — What was verified live
Verified on `localhost:5200`, signed in as a real `is_admin` account, against live Supabase data:

| Check | Result |
|---|---|
| First log on an empty ledger | ✅ logged, no dialog |
| Same type again → dialog fires | ✅ dialog opened (renderer blocked — that block *is* the evidence) |
| Cancel / abandon → nothing written | ✅ row still showed exactly one badge afterwards |
| Different type, same booking → no dialog | ✅ logged, **no dialog, no freeze**, badge + summary cards updated |
| **Confirm through the dialog → logs anyway** | ✅ **observed live** — manual click; a 3rd `EasyWallet received` badge (5th overall) appeared on the Test 2 Plombier row |

The **different-type** row is the strongest single result: the *same* button, the *same* row, the
*same* click sequence — freezing on a duplicate type and passing straight through on a new one.
The guard discriminates correctly, shown rather than asserted.

✅ **The OK branch is confirmed, by observation — not merely by construction.** Confirming the
dialog proceeds to `logEvent` and the row is written: a manual click produced a 3rd
`EasyWallet received` badge (the 5th entry overall) on the Test 2 Plombier row. Both branches of
the guard are therefore exercised end to end — cancel writes nothing, OK writes the event.

It had to be done by hand: automation can prove the dialog *opens* (the renderer freeze is the
evidence) but cannot press its buttons (AD17). Worth remembering next time this area is touched —
the confirm path is not something a script can regression-test.
