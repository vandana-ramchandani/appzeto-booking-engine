# Appzeto Booking Engine v2 — Required Test Scenarios

Your API must reproduce ALL 10 scenarios below exactly. The evaluator will run these
against your server on the spot. Assume a fresh database before Scenario 1, seeded only
with the 3 rooms. "Today" = the test day. All times are for tomorrow's date unless stated.

Rooms (seed on startup):

- Alpha — capacity 4
- Beta — capacity 8
- Gamma — capacity 15

Users: register UserA, UserB, UserC, UserD normally. Admin role is set manually in DB
or via a seed script (document how in your README).

---

## Scenario 1 — Basic conflict

1. UserA books Alpha 10:00–11:00. → 201 CONFIRMED
2. UserB books Alpha 10:30–11:30. → 409 with error naming the conflicting time range.

## Scenario 2 — Boundary touch is NOT a conflict

1. UserA books Beta 10:00–11:00. → 201
2. UserB books Beta 11:00–12:00. → 201 (end time == start time of next is allowed)

## Scenario 3 — Validation set (each returns 400 with a clear, specific message)

a. Booking 08:30–09:30 (starts before 09:00)
b. Booking 18:30–19:30 (ends after 19:00)
c. Booking 10:00–10:15 (under 30 min)
d. Booking 10:00–13:30 (over 3 hours)
e. Booking on Alpha with attendees = 5 (capacity 4)
f. Booking for a past date
g. Booking 35 days in the future

## Scenario 4 — Daily limit

UserA creates 2 bookings tomorrow (any rooms, no conflicts). → both 201
UserA attempts a 3rd booking tomorrow. → 403/400 "max 2 active bookings per day"
UserA cancels one, then retries the 3rd. → 201 (cancelled bookings don't count)

## Scenario 5 — Recurring all-or-nothing

1. UserB books Gamma 14:00–15:00 on Day+7. → 201
2. UserA posts a weekly recurrence: Gamma 14:00–15:00, count = 4, starting Day+7
   (occurrences: Day+7, Day+14, Day+21, Day+28). Occurrence 1 conflicts with UserB.
   → EXPECTED: 409, ZERO occurrences saved (all-or-nothing), response body lists the
   exact conflicting date(s). Verify with GET that no partial series exists.
3. UserA retries starting Day+8 (occurrences: Day+8, +15, +22, +29). → 201, four
   linked bookings sharing one seriesId.

## Scenario 6 — Waitlist skip-promotion (core logic)

Setup, in this order, all on Alpha for the same date:

1. UserA books 10:00–12:00. → CONFIRMED
2. UserB requests 10:00–13:00 with joinWaitlist=true. → WAITLISTED, queue #1
3. UserC requests 10:30–11:30 with joinWaitlist=true. → WAITLISTED, queue #2
4. UserD requests 10:00–12:00 with joinWaitlist=true. → WAITLISTED, queue #3
5. UserA cancels the 10:00–12:00 booking.
   EXPECTED:

- UserB (queue #1) does NOT fit (needs until 13:00; only 10:00–12:00 freed*) → skipped.
  (*Assume another CONFIRMED booking exists 12:00–14:00 on Alpha — create it as UserD's
  second booking BEFORE step 5 so the freed window is exactly 10:00–12:00.)
- UserC is promoted to CONFIRMED (10:30–11:30 fits inside 10:00–12:00).
- Queue renumbers: UserB = #1, UserD = #2.
- Audit log contains a PROMOTION entry: who was promoted, which cancellation triggered it,
  timestamp, and who was skipped.

## Scenario 7 — Series partial cancel

From Scenario 5's series (Day+8, +15, +22, +29):
PATCH /api/bookings/series/:seriesId/cancel?from=<Day+15 date>
EXPECTED: Day+8 stays CONFIRMED; Day+15, +22, +29 become CANCELLED.
A new booking by UserB on Gamma 14:00–15:00 on Day+15 now succeeds (slot freed).

## Scenario 8 — Credits ledger

Fresh user UserC, weekly budget 600 minutes:

1. Books 3 hours (180 min). Balance → 420.
2. Books 2 hours (120 min). Balance → 300.
3. Cancels booking #1 more than 2h before its start → FULL refund of 180. Balance → 480.
4. Books a 50-min slot (≥30 min, so valid). Balance → 430.
5. Cancels it LESS than 2h before start → refund = 50% rounded DOWN to nearest 15 min:
   floor(25 / 15) × 15 = 15 min refunded. Balance → 445.
   EXPECTED: GET /api/users/me/credits returns the full ledger: every debit/credit with a
   reason + the final balance (445). Evaluator recomputes by hand.

## Scenario 9 — Idempotency

1. POST /api/bookings with header Idempotency-Key: K1, body X. → 201, booking created.
2. Repeat the EXACT same request (K1, body X). → 200/201 returning the SAME booking id,
   and only ONE booking exists in the DB.
3. POST with Idempotency-Key: K1 but a DIFFERENT body. → 409 "idempotency key reuse".

## Scenario 10 — Race condition

Fire two parallel POSTs (same room, same slot, different users) — e.g., Postman runner,
a small script, or two terminals with & .
EXPECTED: exactly one 201 and one 409. Never two confirmed bookings.
Your README must explain (≈5 lines, your own words) the mechanism you used
(unique index, transaction, etc.) and why it works.

---

Submission: GitHub repo link + Postman collection (or REST client file) + README.
The evaluator runs scenarios live from your collection. Scenarios 6 and 10 carry the
highest weight.
