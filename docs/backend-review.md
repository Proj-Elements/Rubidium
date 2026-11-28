# Backend review

This report records the v1.2.1 review milestone. The subsequent
[v2.0.0-alpha release](v2.0.0-alpha.md) retains the fixes while removing v1
storage, configuration and API compatibility; references to removed v1 routes
below are historical findings.

Review baseline: `3151719` (Rubidium 1.2.1). Fixes are isolated on
`codex/backend-review-20261127`; this review does not publish a release.

The review used three subagents and covered database migrations and queue
mutations, scheduling and forecasting, authentication and token persistence,
all API/MCP routes, Bark/Ntfy adapters, the existing frontend flows, backup and
password-reset tools, startup/container packaging, and GitHub workflows.
Dependency versions and runtime behavior were checked against this checkout.

## Confirmed defects

The following findings are fixed. Each implementation change has a focused
regression or an isolated reproduction; commit references identify the
integrated changes on the task branch.

| Severity | Location | Reproduction and corrected behavior | Commit |
| --- | --- | --- | --- |
| P1 | [snapshot validation](../lib/data-transfer.ts) | Imported notification JSON could substitute endpoints/credentials, and invalid queue options or internal timestamps could reach the scheduler. Unsupported fields, missing live channels, invalid leases, malformed rows and non-SQLite input are rejected before data replacement. | `462d101` |
| P1 | [runtime path resolution](../lib/environment.mjs) | A runtime directory symlink, including a missing child below a symlink, could lead into `.next` and be deleted by a build. Server and CLI inspect existing ancestors before filesystem changes. | `7dd51e2` |
| P1 | [delivery settings](../lib/db.ts) | Older or corrupted queued options could replace live channel configuration. Only validated `sound`, `group` and `icon` overrides reach delivery adapters. | `fc237cb` |
| P2 | [MCP boundary](../app/api/mcp/route.ts) | Cross-origin tool calls with valid credentials were accepted; storage failures escaped the JSON boundary or exposed SQLite details. Requests now receive 403 or sanitized 500/tool errors. | `9a71c11` |
| P2 | [Bearer authentication](../lib/auth.ts) | A lowercase `bearer` read token plus a write-capable cookie created a task. Bearer schemes are case-insensitive and declared tokens cannot fall back to a cookie. | `e3ebf77` |
| P2 | [settings API](../app/api/settings/route.ts) | Non-string `deviceKey` edits returned 200 and advanced the revision while silently retaining the key. They now return 400 without mutation. | `680c38f` |
| P2 | [history cleanup](../app/api/deliveries/route.ts) | February 31 normalized to March 3 and deleted a March 2 record; wrongly typed cleanup flags were also accepted. Strict timestamps and boolean flags are checked before deletion. | `9997519` |
| P2 | [delivery revisions](../lib/db.ts) | Same-millisecond or backwards-clock mutations retained an earlier edit revision. Every delivery mutation now advances its activity timestamp. | `03adb6a` |
| P2 | [configuration failures after claiming](../lib/scheduler.ts) | Invalid stored notification options threw after claiming a message, leaving its attempt open until lease recovery. Configuration errors now close the failed attempt, release the lease, and hold the message pending for repair; storage faults still fail scheduler health and retain lease recovery. | `f30ec39`, `d9bf525` |
| P2 | [request overflow cleanup](../lib/http.ts) | A cancellation promise that never settled prevented an oversized request from receiving its confirmed 413 response. Cancellation failures are consumed without waiting and readers are released. | `fa95884` |
| P2 | [encrypted export decoding](../lib/data-transfer.ts) | Valid multi-megabyte exports exhausted V8's regexp stack. Stack-safe Base64 validation preserves the 40 MiB transfer limit. | `00ef6d7` |
| P2 | [backup restoration](../scripts/data-tools.mjs) | A credential file omitted from the manifest was silently discarded. Restore validates the complete source inventory before creating its target. | `170e8e8` |
| P2 | [password reset](../scripts/password-reset.mjs) | Local environment files were ignored, so reset could change a decoy default database; split UTF-8 terminal chunks damaged the password. Runtime configuration and stream decoding are shared with startup. | `95128af` |
| P2 | [additional workday scheduling](../lib/cron.ts) | A valid 366-date override list repeatedly searched irrelevant dates and exhausted a single task's forecast budget. Conservative time windows prune unrelated searches while preserving DST and calendar rules. | `3255e4a` |
| P2 | [MCP input budget](../app/api/mcp/route.ts) | A valid task containing both advertised 366-date arrays exceeded the adapter's 500-element cap. The bounded budget now accepts valid maximum input and rejects excessive input. | `bee9bc3` |
| P2 | [v5 import compatibility](../lib/data-transfer.ts) | Index-only performance migrations broke old v5 encrypted snapshots. Tables, views and triggers remain strictly checked; source indexes are ignored and target indexes retained. | `7606e7f` |
| P2 | [Ntfy acknowledgements](../lib/ntfy.ts) | Empty or HTML 2xx responses were marked delivered without consuming the body. The adapter requires a nonempty message ID, `event: "message"`, the requested topic, a body of at most 16 KiB, and completion within 15 seconds. | `5e247e8` |
| P2 | [reminder editor](../components/task-editor.tsx), [time conversion](../lib/ui.ts) | Editing/duplicating discarded notification metadata; an unchanged second DST-overlap instant moved an hour earlier. Metadata is preserved and unchanged saved instants retain their occurrence. | `68842a0` |
| P2 | [history retention form](../app/settings/page.tsx) | Unsaved retention edits allowed navigation without the existing discard confirmation. The form now acquires the shared navigation guard. | `1248179` |
| P2 | [frontend response validation](../lib/ui.ts) | Missing task defaults reached detail rendering, string-valued bulk outcomes appeared successful, and malformed schedule/security/audit/export fields passed validation. The client checks consumed fields before rendering and reports a recoverable localized error. | `19f1f21` |
| P3 | [JSON body decoding](../lib/http.ts) | Invalid UTF-8 silently changed input, and cancellation failures changed a confirmed 413 into 400. Decoding is strict and overflow errors retain their status. | `24f1d0f` |
| P3 | [password rate-limit response](../app/api/security/route.ts) | Throttling lost the localized error key. The 429 response now retains it and `retry-after`. | `769beb9` |
| P3 | [Bark push URL](../lib/bark.ts) | An endpoint query/fragment truncated the final path prefix. URL components are cleared after preserving the full path and appending `/push`. | `3894072` |

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

### Runtime notification option boundaries (P1)

Expected: queued reminder options can change only `sound`, `group` and `icon`.
The configured channel supplies its endpoint, credential and topic.

Actual: `deliverySettings` spreads raw stored JSON over live settings, allowing
older or corrupted queued options to substitute an endpoint or credential.
The new scheduler regression demonstrates this substitution before the fix.

Fix: parse the stored options through the existing notification schema, which
validates presentation fields and strips unsupported keys. The channel query
also uses the existing `channelType` name directly. Empty presentation values
still clear their defaults, and current channel credentials remain live.

Validation: all 59 backend-review/scheduler/repair/Ntfy checks pass after the
fix, including a queued-message regression that checks both channel identity
and all three allowed presentation fields.

Invalid JSON or wrongly typed presentation fields also used to escape after
claiming a delivery. Two regressions failed before `f30ec39` and now verify
that the failed attempt closes, the lease clears, healthy messages continue,
and manual retry succeeds after repair. All 61 owning checks pass. Additional
storage regressions in `d9bf525` verify that a configuration query failure
marks scheduler health failed and preserves the 120-second recoverable lease,
and that failure-recording errors roll back atomically. All 11 backend review
checks pass. Storage exceptions remain outside the configuration error catch.

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

The pre-optimization measurements are from `03adb6a`; the combined
implementation measurements below are from `43838d6`. Minor changes outside
the optimized queries and channel lookup can reflect timing variability.

| Component/operation | Before median (ms) | Combined median (ms) |
| --- | ---: | ---: |
| Settings read | 0.036 | 0.035 |
| List 100 channels | 0.172 | 0.168 |
| Task page, 50 rows | 0.503 | 0.490 |
| Delivery page, 50 rows | 28.741 | 0.541 |
| Pending delivery page, 50 rows | 1.889 | 0.334 |
| Retrying delivery page, 50 rows | 2.203 | 2.036 |
| Dashboard statistics | 0.076 | 0.076 |
| Queue capacity, runtime query | 0.837 | 0.142 |
| Old queue-capacity query, comparison only | 0.837 | 0.809 |
| Select due tasks | 0.508 | 0.472 |
| Schedule preview | 0.651 | 0.657 |
| Seven-day forecast, 100 tasks | 91.698 | 102.907 |
| Task input validation | 0.003 | 0.003 |
| Enqueue batch, 25 occurrences | 3.737 | 3.549 |
| Claim one delivery | 0.169 | 0.192 |
| Process one delivery, mocked service | 4.015 | 0.417 |
| Bark adapter, mocked service | 0.024 | 0.029 |
| Ntfy adapter, mocked service | 0.013 | 0.023 |

### Delivery pagination and queue capacity

Before the change, the first 50-row delivery page takes 28.741 ms; pending and
retrying pages take 1.889 and 2.203 ms. The activity-only index leaves SQLite to
sort equal timestamps by occurrence and ID. Composite ordering indexes for
all deliveries and a specific status remove that sort while retaining the
same ordering. The redundant activity-only index is removed. Indexed page
retrieval takes `O(log N + offset + pageSize)`; filtered counts, the combined
retry filter and text searches still depend on matching data size.

On the combined implementation, the first page takes 0.541 ms and the pending
page 0.334 ms (about 53 and 6 times faster). SQLite query plans confirm ordering
index scans without a temporary sort for both. The retry filter remains about
2 ms; an extra partial index did not improve the selected plan and was
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

On the combined implementation the mocked delivery takes 0.417 ms, about
10 times faster.
With `H` stored cooldown keys and `K` active keys, healthy-channel selection
uses an `O(log H + K)` index lookup instead of an `O(C)` channel scan and
per-channel settings queries; matching active cooldowns adds one `O(C)` bulk
pass. The 44 database-init/provider/scheduler/regression checks pass, as do
typecheck and focused ESLint.

### Calendar exception searches and remaining costs

A seven-day forecast with 366 additional workdays previously made 12,817
Croner calls and took about 1.7 seconds in the isolated reproduction. The
bounded search takes about 28 ms; its regression permits at most 200 calls
and compares results across DST, half-hour and quarter-hour offset zones.
The override-list scan remains `O(I)` in the number of supplied dates, but
only dates in the relevant time window perform expensive calendar searches.

The generic 100-task forecast takes about 103 ms in the combined benchmark,
versus 92 ms in the earlier run; this path has no measured improvement.
Deep OFFSET pagination, filtered counts, retry sorting and substring searches
also remain proportional to scanned data. These results do not justify an
additional index or a pagination/API rewrite in this review.

### Shared contracts and concise implementation

Origin checks, timestamp validation, notification-field validation, runtime
directory checks and acknowledgement reading now reuse existing contracts.
The editor uses the installed date library for overlap resolution instead of
custom offset probes. The changes preserve existing queue, API and storage
boundaries and avoid unrelated component redesigns.

### CI selection

Database changes previously selected file-backup tests but omitted encrypted
snapshot import tests, so the index compatibility regression could pass CI.
HTTP helpers also omitted MCP checks, the password-reset script omitted its
own tests, and new backend/cron regression modules had no source mapping.
These owners are now selected explicitly.

The browser job previously called the entire browser suite for any affected
UI/API file. The selector now passes named interaction files to Playwright,
includes newly added specs, and gives unknown UI components the workspace
integration check. An empty selection cannot silently launch all browser
tests. Existing version-tag global validation is preserved.

Validation: all 23 CI-selection and release-contract checks pass, including
workflow YAML/shell syntax and the third-party license inventory. Focused
ESLint and whitespace checks also pass.

The final ownership follow-up (`43838d6`) adds overview/upcoming browser
interactions, API/MCP integration for notification helpers, password reset and
environment checks for runtime paths, and backend regressions for scheduler
changes. Four selector cases fail before these mappings and all 23 checks
pass afterward.

## Dependency audit

`pnpm audit --prod --json` identified the upstream high-severity advisory
GHSA-62ch-8vmq-8xm7 in `heroui-pro > figlet@1.11.0`. Narrow-width wrapping with
`whitespaceBreak: true` loops without progress. The setup CLI is a build-time
dependency; no application route exposes those Figlet options.

An isolated subprocess reproduced the affected call exceeding a two-second
timeout. A targeted override pins only this transitive dependency to the
patched `1.11.3`; the identical call then completes. pnpm regenerated the
lockfile, and the license inventory changes only the Figlet version.

Validation: frozen installation succeeds, the production audit reports zero
known vulnerabilities, and all 23 CI-selection/release checks pass. The
third-party notices still match all 446 production dependency entries. Remove
the override when the setup CLI's dependency range excludes affected versions.

The full audit additionally found seven development advisories: six in
`heroui-setup@1.0.4 > tar@7.5.13` and GHSA-g3hv-75wg-m249 in the eleven ESLint
paths converging on `@typescript-eslint/typescript-estree@8.71.2 >
minimatch@10.2.6`. Tar processes downloaded archives during setup and container
builds. The affected Minimatch operation is configuration glob handling;
the actual parser caller's default optimization level does not reach the
advisory's amplification path.

`d6b340e` pins only these exact consumers to Tar 7.5.21 and Minimatch 11.0.1.
Minimatch crosses the parser's declared 10.x range because no audited safe
10.x release is available. Its public matcher API and CommonJS/ESM entry
points remain compatible; isolated matching cases and an actual project-aware
parser invocation pass. Production Tar and separate Minimatch 3.x consumers
retain their existing versions. Official pnpm lockfile regeneration also
reuses the already declared PostCSS 8.5.31 for Tailwind's dependency.

Bounded reproductions demonstrate the Tar PAX parsing failure and the
Minimatch level-2 amplification before the updates. Frozen installation,
ESLint, project-aware TypeScript parsing and all seven release/notice checks
pass afterward. Both full and production audits now report zero advisories;
the production notice inventory still contains 446 entries. The scoped
overrides have explicit removal conditions in `pnpm-workspace.yaml`.

## Combined validation

Local verification covers the combined implementation through `43838d6`.
The following are separate focused runs; overlapping modules are not added
together as a unique test total.

| Check | Result |
| --- | --- |
| API/MCP/Bark/Ntfy/transfer/UI integration after adapter fixes | 92 passed |
| Runtime notification options with backend-review/scheduler/repair/Ntfy owners | 59 passed |
| Invalid configuration claim handling with backend-review/scheduler/repair/Ntfy owners | 61 passed |
| Configuration/storage failures, scheduler health and lease recovery | 11 passed |
| Final frontend contracts with UI/cron-review/transfer owners | 46 passed |
| Final request reader with HTTP/API/MCP/transfer owners | 68 passed |
| CI selector, workflow syntax, release contracts and notices | 23 passed |
| Selected Chromium/WebKit interactions across ten owning files | 76 covered and passed: 74 in the combined pass, then both corrected bulk-result fixture cases in a focused rerun |
| Next route type generation, TypeScript and ESLint | Passed |
| Production build and standalone artifact verification | Passed; no runtime database, credentials or `.env` files in output |
| Frozen dependency install, full/production audits and notices | Passed; zero known advisories, 446 notice entries |
| Parser using the overridden Minimatch 11.0.1 | Passed with actual project-aware TypeScript parsing |

The browser pass exercises reminder metadata/duplication, saved DST overlap
instants, malformed-response recovery, unsaved navigation, channels, encrypted
transfer, access security, setup, responsive lists and short touch landscapes.
Screenshots from both engines were inspected for the new editor,
discard-confirmation and response-error flows. The successful bulk-operation
fixture now includes the item IDs returned by the real API.

An isolated standalone-server probe using native Node HTTP also passes seven
checks: HTTP and forwarded-HTTPS same-origin requests create reminders;
wrong schemes, cross-origin and non-serialized origins return 403; chunked
oversized bodies return localized JSON 413 with request IDs, including a
client that deliberately keeps its upload open. The test server shuts down
and removes its temporary database.

Separate native-fetch adapter verification confirms a stalled Ntfy 200 body
times out after 15,005.81 ms. An oversized response fails in 1.96 ms even when
its cancellation never settles, with its reader unlocked. These measurements
use isolated loopback services and the same integrated adapter implementation.

### Channel test follow-up

At `bf22357`, [push CI](https://github.com/Proj-Elements/Rubidium/actions/runs/46023533639)
passed 280 affected Node checks, all 76 selected browser checks, the production
build and the cold Linux container/startup/retry checks. The corresponding
[PR run](https://github.com/Proj-Elements/Rubidium/actions/runs/46024200764)
passed its backend/build/container checks and 75 browser checks, but timed out
while closing the channel-selection editor in WebKit.

The test pressed Escape after selecting a channel had already closed the
popover. An isolated WebKit reproduction confirms that Escape then opens the
unsaved-change confirmation and makes the editor inert, so its close button
cannot receive the next click. The test now waits for the selector's closed
state, clicks the editor close button, and explicitly awaits and resolves the
named discard dialog. Application behavior is unchanged.

The corrected channel test passes in Chromium and WebKit (2/2), and focused
ESLint passes. Before/after screenshots and dialog state were inspected. CI
results for the final revision remain attached to the branch and PR.

## Verification limits

GitHub CI and container results are attached to the published branch/PR's
current commit; consult the [branch runs](https://github.com/Proj-Elements/Rubidium/actions?query=workflow%3Aci+branch%3Acodex%2Fbackend-review-20261127).
The earlier successful runs for `03adb6a` and `7d6b7d4` cover only those earlier
candidates. Local builds reuse the exact installed HeroUI
Pro 1.0.0-beta.11 licensed artifacts; a cold licensed install and Linux
container build are verified separately by the repository's CI.

The notification checks use mocks or isolated loopback services. Actual Bark
device display, real Ntfy service latency and deployment capacity were not
measured. An ambiguous or lost acknowledgement remains retryable and can
produce a duplicate if the service accepted the original message.

Forwarded HTTPS headers were exercised against the real Next.js standalone
handler; a specific production TLS proxy configuration was not deployed.
Global version-tag validation, release publication and production deployment
are outside this task's branch-delivery boundary.
