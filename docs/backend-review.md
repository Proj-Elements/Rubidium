# Backend review

Review baseline: `3151719` (Rubidium 1.2.1). Fixes are isolated on
`codex/backend-review-20261127`; this review does not publish a release.

## Confirmed defects

### Delivery edit revision collisions (P2)

Expected: a delivery mutation invalidates earlier edit snapshots, including
concurrent requests in one millisecond and a wall clock adjustment.

Actual: `editDelivery`, manual retry and send failure can write the same
`activity_at` value. The API uses this timestamp as its optimistic revision,
so a stale request can overwrite newer content or state.

Reproduction: create and enqueue a one-time reminder at a fixed clock tick;
perform two edits with its original `updatedAt` and that same tick. Both
currently succeed. `tests/backend-review.test.ts` covers edits, manual retry,
send failure and a backwards clock. All four regressions fail on the baseline.

Fix: share one SQL expression that advances the timestamp by one millisecond
when the supplied clock is not later than the existing activity. Apply it to
delivery mutations while keeping the API timestamp contract and lease checks.

Validation: the four new regressions and the scheduler/workflow modules pass
all 50 checks after the fix. Focused ESLint and `git diff --check` also pass.

## Baseline validation

The owning database/scheduler suites (`db-init`, `scheduler`, `persistence`,
`workflow`, `repairs`) pass all 75 checks before changes. These include
transaction rollback, migration, restart, lease recovery, queue backpressure
and retention. New regressions and performance measurements are recorded
with their fixes below.
