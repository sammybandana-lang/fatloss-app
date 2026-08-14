-- Grants the daily background job's role access to the tables it uses.
--
-- Why this is needed: `service_role` bypasses Row-Level Security, but RLS
-- and table privileges are two separate systems. Bypassing RLS does not
-- grant SELECT/INSERT/UPDATE on a table. Every earlier migration here
-- granted privileges to `authenticated` only, so the daily job's client
-- got "permission denied for table workouts" on its very first query even
-- though it holds the service-role key.
--
-- Least privilege, deliberately:
--   * No DELETE anywhere. The job only ever reads, syncs and appends —
--     it has no reason to destroy data, so it cannot.
--   * Read-only on `goals` and `measurements`, which the job only reads.
--   * Nothing is granted to `anon`.
--
-- Isolation is unaffected: the job's queries all filter on user_id
-- explicitly (see lib/ai/assessment-input.ts and lib/jobs/daily-assessment.ts),
-- which is what keeps users apart once RLS is out of the picture.

-- Read-only: the job reads these to build the assessment, never writes them.
grant select on goals to service_role;
grant select on measurements to service_role;

-- Synced from LoseIt and Hevy: read + append + update-on-resync (upsert).
grant select, insert, update on diet_entries to service_role;
grant select, insert, update on workouts to service_role;
grant select, insert, update on workout_exercises to service_role;
grant select, insert, update on workout_sets to service_role;

-- The job's own table: it writes the assessment, then stamps sent_at.
grant select, insert, update on daily_assessments to service_role;
