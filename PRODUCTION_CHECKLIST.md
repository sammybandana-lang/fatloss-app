# Checklist for Production-Level SaaS Performance

Observations from the fatloss-app codebase review, organized as a checklist for Phalanx or any multi-tenant SaaS. The fatloss-app architecture already has seams for every item below — nothing requires a rewrite, all work is additive.

---

## 1. Performance & Scalability

### 1.1 Batch database writes

**Current state:** `upsertWorkout` awaits each exercise sequentially, each with its own sets upsert. A workout with 8 exercises is 16 sequential DB round-trips.

**At scale:** Hundreds of tenants syncing concurrently hold connections open far longer than needed.

**Fix:** Batch into one upsert call for all exercises and one for all sets per workout.

- [ ] Replace sequential `await` loop in `upsertWorkout` with batched upserts
- [ ] Verify idempotency is preserved after batching (conflict columns still match)

### 1.2 Incremental sync (high-water mark)

**Current state:** `syncHevyWorkouts` fetches ALL workouts every sync, with no "since last sync" marker.

**At scale:** 1,000 tenants × 500 workouts each = half a million rows re-fetched and re-upserted per sync cycle.

**Fix:** Store a `last_synced_at` timestamp per tenant per source. Fetch only what's new.

- [ ] Add `last_synced_at` column (or separate `sync_cursors` table) per tenant per source
- [ ] Modify sync actions to pass the cursor to the external API
- [ ] Update the cursor after each successful sync

### 1.3 Collapse N+1 query patterns

**Current state:** `getWorkoutsForDate` and `getLatestWorkout` each run three sequential queries — workouts, then exercises, then sets.

**At scale:** Every dashboard page load is 3+ round-trips per data section. Multiplied by concurrent users, this saturates the connection pool.

**Fix:** Use Supabase nested selects (`workouts(workout_exercises(workout_sets))`) to collapse to one round-trip.

- [ ] Refactor `getWorkoutsForDate` to use nested selects
- [ ] Refactor `getLatestWorkout` to use nested selects
- [ ] Deduplicate the shared workout-fetching logic between `lib/hevy/queries.ts` and `lib/ai/assessment-input.ts`

### 1.4 Connection pooling

**Current state:** Every server action creates a fresh Supabase client. No connection pooler configured.

**At scale:** Hundreds of concurrent requests exhaust the Supabase connection pool (default is low on free/pro tiers).

**Fix:** Enable Supabase's built-in PgBouncer pooler. Use the pooled connection string for server actions; direct connection for migrations only.

- [ ] Enable PgBouncer in Supabase dashboard
- [ ] Switch server-side `createClient` to use the pooled connection string
- [ ] Keep direct connection string for migration tooling only

### 1.5 Caching layer

**Current state:** Goals, latest measurement, and yesterday's nutrition all hit the DB on every page load. No caching.

**At scale:** These values change at most once a day. Hundreds of users reloading dashboards means thousands of identical queries per minute.

**Fix:** Short-TTL caching (even 60 seconds) via Next.js ISR, `unstable_cache`, or a Redis layer.

- [ ] Identify cacheable queries (goals, latest measurement, yesterday's nutrition)
- [ ] Implement caching with appropriate TTL and invalidation on writes
- [ ] Ensure cache is tenant-scoped (never serve tenant A's data to tenant B)

### 1.6 Background job infrastructure

**Current state:** Sync runs in the request cycle. User waits for external API calls to complete.

**At scale:** External APIs (Hevy, Gmail, carrier APIs on Phalanx) have their own rate limits and latency. Running in the request cycle blocks the user and risks timeouts.

**Fix:** Move sync to background jobs with retry, backoff, and per-tenant rate limiting. trigger.dev is already on the roadmap.

- [ ] Set up trigger.dev (or equivalent job runner)
- [ ] Move Hevy sync to a background job
- [ ] Move LoseIt ingestion to a background job
- [ ] Add per-tenant rate limiting against external APIs
- [ ] Add retry with exponential backoff
- [ ] Add dead-letter / failure alerting

---

## 2. Operational Readiness

### 2.1 Monitoring & alerting

- [ ] Structured logging on all server actions (tenant ID, action, duration, outcome)
- [ ] Alert on sync failures (the system knows before the user does)
- [ ] Alert on elevated error rates, latency spikes, connection pool exhaustion
- [ ] Dashboard for per-tenant sync health (last successful sync, failure count)

### 2.2 Error boundaries

- [ ] Add React error boundaries around each dashboard section so one component crashing doesn't blank the page
- [ ] Graceful degradation — show stale data with a "last updated" timestamp rather than an error

### 2.3 Health check endpoints

- [ ] `/api/health` — exercises at least one query per critical table and one call per critical external integration
- [ ] Wired into post-deploy smoke tests (CI fails the deploy if health check returns errors)

### 2.4 Rate limiting on own API surface

- [ ] Rate limit sync endpoints per tenant (prevent one tenant from monopolizing resources)
- [ ] Rate limit auth endpoints (prevent brute force)

---

## 3. Multi-Tenant Completeness

### 3.1 Tenant lifecycle

- [ ] Provisioning / onboarding flow (signup, initial config, first sync)
- [ ] Per-tenant configuration (different carriers, different goals, custom thresholds)
- [ ] Tenant admin views (usage, sync status, user management)
- [ ] Offboarding (data export, data deletion, account deactivation)

### 3.2 Tenant isolation verification

- [ ] Two-tenant integration test on every table (already documented in LESSONS_LEARNED.md)
- [ ] RLS policies verified for all four CRUD paths on every table
- [ ] UPDATE policies have both `using` and `with check`

---

## 4. Auth Hardening

- [ ] Replace `ONLY_ALLOWED_USER_ID` single-user gate with real invite/signup flow
- [ ] Session refresh handling (token expiry during long sessions)
- [ ] Account recovery flow
- [ ] MFA support (if enterprise buyers require it)
- [ ] Audit log on auth events (login, logout, password change, failed attempts)

---

## 5. Compliance & Data Governance

- [ ] Data retention policy enforced (not just documented) — automated purge after defined period
- [ ] Encryption at rest confirmed and documented
- [ ] Storage region pinned and documented (relevant for GDPR, data residency requirements)
- [ ] Audit log on sensitive writes (measurements, goals, assessment generation)
- [ ] Data export capability per tenant (GDPR right of access / portability)
- [ ] Data deletion capability per tenant (GDPR right to erasure)
- [ ] Security overview document for buyer due diligence (not a SOC 2 report — a self-assessment)

---

## 6. Code Hygiene (Pre-Scale Cleanup)

These are not blockers but become maintenance burdens at scale with multiple contributors.

- [ ] Extract shared nav component (currently copy-pasted across four pages)
- [ ] Move `formatDateShort` to `lib/dates.ts` (currently duplicated in `app/page.tsx` and `AssessmentClient.tsx` with slightly different implementations)
- [ ] Deduplicate workout-fetching logic between `lib/hevy/queries.ts` and `lib/ai/assessment-input.ts`
- [ ] Add error boundaries to all page-level components

---

## What's Already Right

These items are production-grade as-is and transfer directly to Phalanx:

- RLS at the DB layer on every table, scoped to the tenant identity
- Server-side validation on every write (never trusts the client)
- Adapter pattern on every external dependency (Gmail, Hevy, Supabase)
- Idempotent upserts everywhere (safe to retry, safe to reprocess)
- Structured-numeric-only LLM input with documented prompt injection mitigation
- Discriminated union state management in client components
- Eastern timezone handling with DST-aware date logic
- Comprehensive test suite including real-data fixtures and two-user isolation tests
- Documented lessons learned and architecture decisions

---

*This checklist is derived from a review of the fatloss-app codebase as of August 8, 2026. It is ordered roughly by impact: performance fixes first (they gate everything else), then operational readiness, then tenant completeness, then compliance. The architecture supports all of it without a rewrite.*
