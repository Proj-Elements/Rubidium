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

## Performance and implementation clarity

The repeatable benchmark is `TZ=Asia/Shanghai node --import tsx
scripts/benchmark-backend.mjs`. It creates a temporary database with 100 tasks,
100 additional channels, 100,000 historical deliveries and 10,000 pending
deliveries. It never contacts configured notification services. Results are
local warm-cache medians of 20 samples on Node 26.7.0, not deployment capacity
or real network measurements.

### Delivery pagination and queue capacity

Before the change, the first 50-row delivery page takes 28.741 ms; pending and
retrying pages take 1.889 and 2.203 ms. The activity-only index leaves SQLite to
sort equal timestamps by occurrence and ID. Composite ordering indexes for
all deliveries and a specific status remove that sort while retaining the
same ordering. The redundant activity-only index is removed. Indexed page
retrieval takes `O(log N + offset + pageSize)`; filtered counts, the combined
retry filter and text searches still depend on matching data size.

After the change, the first page takes 0.602 ms and the pending page 0.361 ms
(about 48 and 5 times faster in this run). SQLite query plans confirm ordering
index scans without a temporary sort for both. The retry filter remains about
2.2 ms; an extra partial index did not improve the selected plan and was
removed. The 34 owning database/migration/repair checks pass, including a
pagination boundary test with tied timestamps and status filters. Focused
ESLint and whitespace checks pass.

The queue capacity query also reads task IDs from every queued row to count a
single task. Two scalar counts use covering status and task/status indexes,
reducing the measured query from 0.837 to 0.149 ms before any index additions.
The global count remains linear in pending/sending rows; backpressure stays
transactional and exact.

### Scheduler channel lookups

The baseline sends each mocked delivery in 4.015 ms with 100 extra channels.
Before claiming every message, it reloads and validates defaults separately
for each channel, then reads each endpoint cooldown. This repeats linear
configuration work even when no endpoint is cooling down.

The scheduler now queries active cooldown keys through an expiry index first.
Healthy endpoints require no channel scan. When cooldowns exist, one bulk
channel read matches their identities. This preserves shared Bark credentials,
distinct Ntfy topics and live credential changes. A focused integration test
covers all three. The duplicated default/named-channel branches in
`deliverySettings` are also reduced to one lookup with the same default fallback.

After the change the mocked delivery takes 0.402 ms, about 10 times faster.
With `H` stored cooldown keys and `K` active keys, healthy-channel selection
uses an `O(log H + K)` index lookup instead of an `O(C)` channel scan and
per-channel settings queries; matching active cooldowns adds one `O(C)` bulk
pass. The 44 database-init/provider/scheduler/regression checks pass, as do
typecheck and focused ESLint.
