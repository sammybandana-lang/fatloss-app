-- Azure migration, Phase 2, step 2 of 3. See ARCHITECTURE.md §10.4.
--
-- WHAT THIS DOES
--
-- Step 1 built the replacement for Supabase's auth.uid() and proved it
-- works (app_current_user_id(), tests/app-users-shim.test.ts). Nothing
-- used it yet.
--
-- This migration switches every wall rule in the database over to it:
-- 26 policies across 8 tables, plus the 6 column defaults that stamp new
-- rows with their owner.
--
-- It also closes the owner loophole. On stock PostgreSQL — which is what
-- Azure Database for PostgreSQL is — whoever OWNS a table is exempt from
-- its RLS policies unless FORCE ROW LEVEL SECURITY is set. Supabase's
-- setup hides this today because the app never connects as the owner. On
-- Azure it would mean every policy in this file silently stops applying,
-- with nothing failing to warn you. `force row level security` is the
-- switch that closes it, and it is pulled forward to here (rather than
-- step 3) so the isolation tests start exercising the Azure-shaped
-- configuration now instead of after the move.
--
-- ONE FILE ON PURPOSE. PostgreSQL runs a migration in a transaction, so
-- this either applies completely or not at all. Split across several
-- files, a failure partway through would leave some tables asking the new
-- question and some asking the old one — walls in two different states at
-- once, which is a genuinely confusing thing to debug.
--
-- WHY THIS IS SAFE TO APPLY WHILE THE APP IS RUNNING
--
-- app_current_user_id() checks auth.uid() FIRST and falls back to the
-- connection setting only when that is null (step 1, and the comments
-- there explain why that order is a security decision). Under Supabase
-- today auth.uid() always answers, so every rule below resolves to
-- exactly the value it resolved to before this migration. The behaviour
-- is identical; only the question's name changes. The fallback branch
-- stays dormant until Phase 3 introduces the node-postgres client.
--
-- WHAT THIS DOES NOT CHANGE
--
-- Roles with BYPASSRLS — which is how `service_role` works — are
-- unaffected by both RLS and FORCE RLS. The daily background job and the
-- service-role seeding in tests/isolation.test.ts keep working exactly as
-- they do now.
--
-- ONE VISIBLE SIDE EFFECT, EXPECTED, NOT A BUG
--
-- If the `postgres` role owns these tables and does not carry BYPASSRLS,
-- then after this migration the Supabase dashboard's table editor and SQL
-- editor may show ZERO ROWS for these tables. That is the loophole being
-- closed, working as designed — the data is untouched. To read a table as
-- an operator, either query it with the service-role key, or set the
-- identity for the session first:
--
--     set local app.current_user_id = '<your-user-uuid>';
--     select * from measurements;
--
-- This is the same operator-access gap ARCHITECTURE.md §10.5 #5 predicts
-- for the Azure move, arriving early. Worth knowing before it surprises
-- you at a keyboard.
--
-- REVERSING THIS FILE
--
-- There is no automatic down migration. To undo: re-run each ALTER POLICY
-- below with `(select auth.uid())` in place of `(select
-- app_current_user_id())`, reset the six defaults to `auth.uid()`, and
-- `alter table <t> no force row level security` on all eight. Nothing here
-- drops or creates a policy, so no rule is ever missing mid-flight.


-- ============================================================
-- measurements
-- ============================================================
alter policy "select own measurements" on measurements
  using ((select app_current_user_id()) = user_id);
alter policy "insert own measurements" on measurements
  with check ((select app_current_user_id()) = user_id);
alter policy "update own measurements" on measurements
  using ((select app_current_user_id()) = user_id)
  with check ((select app_current_user_id()) = user_id);
alter policy "delete own measurements" on measurements
  using ((select app_current_user_id()) = user_id);

alter table measurements alter column user_id set default app_current_user_id();
alter table measurements force row level security;


-- ============================================================
-- workouts
-- ============================================================
alter policy "own workouts - select" on workouts
  using ((select app_current_user_id()) = user_id);
alter policy "own workouts - insert" on workouts
  with check ((select app_current_user_id()) = user_id);
alter policy "own workouts - update" on workouts
  using ((select app_current_user_id()) = user_id)
  with check ((select app_current_user_id()) = user_id);
alter policy "own workouts - delete" on workouts
  using ((select app_current_user_id()) = user_id);

alter table workouts alter column user_id set default app_current_user_id();
alter table workouts force row level security;


-- ============================================================
-- workout_exercises
-- ============================================================
alter policy "own exercises - select" on workout_exercises
  using ((select app_current_user_id()) = user_id);
alter policy "own exercises - insert" on workout_exercises
  with check ((select app_current_user_id()) = user_id);
alter policy "own exercises - update" on workout_exercises
  using ((select app_current_user_id()) = user_id)
  with check ((select app_current_user_id()) = user_id);
alter policy "own exercises - delete" on workout_exercises
  using ((select app_current_user_id()) = user_id);

alter table workout_exercises alter column user_id set default app_current_user_id();
alter table workout_exercises force row level security;


-- ============================================================
-- workout_sets
-- ============================================================
alter policy "own sets - select" on workout_sets
  using ((select app_current_user_id()) = user_id);
alter policy "own sets - insert" on workout_sets
  with check ((select app_current_user_id()) = user_id);
alter policy "own sets - update" on workout_sets
  using ((select app_current_user_id()) = user_id)
  with check ((select app_current_user_id()) = user_id);
alter policy "own sets - delete" on workout_sets
  using ((select app_current_user_id()) = user_id);

alter table workout_sets alter column user_id set default app_current_user_id();
alter table workout_sets force row level security;


-- ============================================================
-- diet_entries
-- ============================================================
alter policy "own diet - select" on diet_entries
  using ((select app_current_user_id()) = user_id);
alter policy "own diet - insert" on diet_entries
  with check ((select app_current_user_id()) = user_id);
alter policy "own diet - update" on diet_entries
  using ((select app_current_user_id()) = user_id)
  with check ((select app_current_user_id()) = user_id);
alter policy "own diet - delete" on diet_entries
  using ((select app_current_user_id()) = user_id);

alter table diet_entries alter column user_id set default app_current_user_id();
alter table diet_entries force row level security;


-- ============================================================
-- goals
--
-- user_id is this table's PRIMARY KEY, not just an owner column. The
-- default still applies on insert, so nothing special is needed here —
-- noted only because it makes goals the one table where getting the
-- default wrong would break the primary key rather than just the
-- ownership stamp.
-- ============================================================
alter policy "select own goals" on goals
  using ((select app_current_user_id()) = user_id);
alter policy "insert own goals" on goals
  with check ((select app_current_user_id()) = user_id);
alter policy "update own goals" on goals
  using ((select app_current_user_id()) = user_id)
  with check ((select app_current_user_id()) = user_id);
alter policy "delete own goals" on goals
  using ((select app_current_user_id()) = user_id);

alter table goals alter column user_id set default app_current_user_id();
alter table goals force row level security;


-- ============================================================
-- daily_assessments
--
-- One policy only: select, for the owner. The background job is the sole
-- writer and reaches this table as service_role, which bypasses RLS —
-- unchanged by anything here. No column default to convert: that omission
-- is deliberate and documented in 20260810143000.
-- ============================================================
alter policy "own daily assessments - select" on daily_assessments
  using ((select app_current_user_id()) = user_id);

alter table daily_assessments force row level security;


-- ============================================================
-- app_users
--
-- Created in step 1 still asking Supabase's question. Converted here with
-- the rest so that no table is left as the odd one out — the next person
-- reading this schema should find exactly one way of asking "who is
-- asking?", not two.
-- ============================================================
alter policy "select own app_user" on app_users
  using ((select app_current_user_id()) = id);

alter table app_users force row level security;


-- ============================================================
-- Self-check: prove the conversion is complete before committing
-- ============================================================
--
-- A migration that half-applied would be the worst outcome here, and the
-- symptom would be silent. This block makes the database itself assert
-- the end state: if a single policy anywhere in `public` still reaches
-- for auth.uid(), or the converted count is not what this file claims,
-- the exception rolls the whole transaction back and nothing changes.
--
-- Checking pg_policies rather than trusting that the statements above
-- were written correctly — the point is to catch a typo in THIS file, so
-- it must read the result, not restate the intent.

do $$
declare
  v_stale   int;
  v_shimmed int;
begin
  select count(*) into v_stale
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') like '%auth.uid()%'
      or coalesce(with_check, '') like '%auth.uid()%');

  if v_stale > 0 then
    raise exception
      'Phase 2 step 2 incomplete: % policy/policies in public still reference auth.uid()', v_stale;
  end if;

  select count(*) into v_shimmed
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') like '%app_current_user_id()%'
      or coalesce(with_check, '') like '%app_current_user_id()%');

  if v_shimmed <> 26 then
    raise exception
      'Phase 2 step 2: expected 26 policies on the shim, found %. Refusing to apply a partial conversion.', v_shimmed;
  end if;

  raise notice 'Phase 2 step 2: % policies converted to app_current_user_id(), 0 left on auth.uid().', v_shimmed;
end;
$$;
