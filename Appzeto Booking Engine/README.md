# Appzeto Booking Engine

## Idempotency + race safety (≈5 lines)

POST /api/bookings supports an `Idempotency-Key` header. We store the first successful (or WAITLISTED) response in the `Idempotency` collection keyed by `(userId, key)`; subsequent requests with the same key return the stored response.

For race safety on confirmed slots, the `Booking` model defines a Mongo **unique partial index** on `(roomId, date, startTime, endTime)` for `status = CONFIRMED`. Parallel POSTs for the same slot therefore result in exactly one successful insert; the other fails with a duplicate-key conflict which we map to HTTP 409.
