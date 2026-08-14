-- One row per user per assessed day, written by the daily background job
-- (lib/jobs/daily-assessment.ts). Two jobs in one table:
--   1. A record of what was sent to the trainer, and what data it was based on.
--   2. The idempotency guard. `sent_at` is what stops a retry (or a manual
--      re-run) emailing the trainer twice for the same day.

create table daily_assessments (
  id uuid primary key default gen_random_uuid(),
  -- NOTE: deliberately no `default auth.uid()`, unlike every other table
  -- here. Only the background job writes this table, and it uses the
  -- service-role key where auth.uid() is NULL. A default would silently
  -- produce a NOT NULL violation instead of a clear "you forgot user_id".
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The Eastern calendar date being assessed (yesterday, at the time the
  -- job runs). Supplied by the job from yesterdayInEasternTime(); never
  -- `default current_date`, which is UTC on Supabase and would disagree
  -- with the app's Eastern date logic in lib/dates.ts.
  assessment_date date not null,

  -- Snapshot of the numbers the assessment was based on, so the email can
  -- be reconstructed and explained later without re-querying (and
  -- re-deriving) history that may since have changed.
  weight_lbs_start numeric,
  weight_lbs_goal numeric,
  weight_lbs_current numeric,
  calories integer,
  protein_g integer,
  workout_present boolean not null,
  workout_volume_lbs numeric,
  workout_names text[] not null default '{}',

  -- The LLM's output.
  short_assessment text not null,
  grade text not null check (grade in ('A+', 'B+', 'C', 'D')),
  model text not null,

  -- Null until the trainer email actually goes out. Set only after a
  -- successful send.
  sent_at timestamptz,
  created_at timestamptz not null default now(),

  -- The idempotency key: at most one assessment per user per day.
  unique (user_id, assessment_date)
);

-- ============================================================
-- Row-Level Security: enable, then grant the minimum
-- ============================================================
alter table daily_assessments enable row level security;

-- Read-only for logged-in users: they can see their own assessments, and
-- nothing else. No insert/update/delete grants or policies at all — the
-- background job is the only writer and it uses the service-role key,
-- which bypasses RLS. Start locked; open only what is needed.
grant select on daily_assessments to authenticated;

create policy "own daily assessments - select" on daily_assessments
  for select using ((select auth.uid()) = user_id);

create index daily_assessments_user_date_idx
  on daily_assessments (user_id, assessment_date desc);
