-- Azure migration, Phase 2, step 3 of 3. See ARCHITECTURE.md §10.4.
--
-- WHAT THIS DOES
--
-- Every row of data carries a note saying who it belongs to. Those notes
-- are currently checked against Supabase's own private list of accounts
-- (auth.users). This points them at our list instead (app_users, built in
-- step 1).
--
-- Nothing is copied, moved, or rewritten. app_users was deliberately
-- keyed on the SAME id Supabase already issued, so every user_id value in
-- every table already matches a row in app_users. This changes which
-- table the reference points at, and nothing else.
--
-- SCOPE CHANGE FROM THE ORIGINAL PLAN
--
-- ARCHITECTURE.md §10.4 scoped step 3 as "foreign keys repoint, app
-- roles, FORCE ROW LEVEL SECURITY". Two of those have moved:
--
--   * FORCE ROW LEVEL SECURITY was pulled forward into step 2.
--   * Creating the app_user / app_job roles is DEFERRED to Phase 3.
--     Nothing can connect as them until node-postgres replaces
--     PostgREST, so building them now would add two roles to the schema
--     that no test could exercise. Untestable scaffolding is how errors
--     hide. They arrive in Phase 3, where they can be used the day they
--     are created.
--
-- So this file is foreign keys only.
--
-- THE DELETE CHAIN IS PRESERVED
--
-- Deleting a user must still take their data with them — a real "delete
-- my account" request depends on it, and tests/helpers/test-users.ts
-- relies on it for cleanup. Before this migration:
--
--     auth.users  --cascade-->  measurements, workouts, ...
--
-- After it:
--
--     auth.users  --cascade-->  app_users  --cascade-->  measurements, ...
--
-- One extra hop, same outcome. app_users' own reference to auth.users was
-- created with `on delete cascade` in step 1 precisely so this would hold.
-- That link is dropped at Phase 5, when the new sign-in system takes over
-- and app_users stands on its own.
--
-- REVERSING THIS FILE
--
-- For each table: drop the constraint added below and re-add it pointing
-- at `auth.users (id) on delete cascade`. No data changes either way.


-- ============================================================
-- Pre-flight checks — refuse to run on a database that isn't
-- in the state this file expects
-- ============================================================
--
-- Two things could make this migration do something surprising, and both
-- are cheap to rule out first. If either check fails, the exception rolls
-- the whole transaction back and nothing is altered.
--
--   1. A constraint is named something other than what this file expects.
--      The DROP statements below name constraints explicitly, so a
--      surprise name would otherwise produce a confusing mid-file error.
--   2. A row exists whose owner is not in app_users. Adding the new
--      reference would fail on it. Postgres' own error for this is
--      accurate but cryptic; this one says which table.

do $$
declare
  v_expected text[] := array[
    'measurements', 'workouts', 'workout_exercises', 'workout_sets',
    'diet_entries', 'goals', 'daily_assessments'
  ];
  v_table   text;
  v_found   int;
  v_orphans int;
begin
  foreach v_table in array v_expected loop
    -- Check 1: the constraint exists, is a foreign key on user_id, and
    -- currently points at auth.users.
    select count(*) into v_found
    from pg_constraint c
    join pg_class      t   on t.oid = c.conrelid
    join pg_class      ref on ref.oid = c.confrelid
    join pg_namespace  rn  on rn.oid = ref.relnamespace
    where c.conname = v_table || '_user_id_fkey'
      and t.relname = v_table
      and c.contype = 'f'
      and rn.nspname = 'auth'
      and ref.relname = 'users';

    if v_found <> 1 then
      raise exception
        'Pre-flight failed: expected a foreign key named %_user_id_fkey on % pointing at auth.users, found %. Refusing to alter anything.',
        v_table, v_table, v_found;
    end if;

    -- Check 2: no row owned by someone missing from app_users.
    execute format(
      'select count(*) from %I d where not exists (select 1 from app_users u where u.id = d.user_id)',
      v_table
    ) into v_orphans;

    if v_orphans > 0 then
      raise exception
        'Pre-flight failed: % has % row(s) whose user_id is not in app_users. Backfill app_users before repointing.',
        v_table, v_orphans;
    end if;
  end loop;

  raise notice 'Pre-flight passed: 7 tables ready to repoint.';
end;
$$;


-- ============================================================
-- Repoint, one table at a time
--
-- Written out explicitly rather than generated in a loop: this is the
-- statement that decides whether a delete removes someone's health data
-- or silently orphans it, and it should be readable without having to
-- work out what a loop expanded to.
-- ============================================================

alter table measurements drop constraint measurements_user_id_fkey;
alter table measurements add constraint measurements_user_id_fkey
  foreign key (user_id) references app_users (id) on delete cascade;

alter table workouts drop constraint workouts_user_id_fkey;
alter table workouts add constraint workouts_user_id_fkey
  foreign key (user_id) references app_users (id) on delete cascade;

alter table workout_exercises drop constraint workout_exercises_user_id_fkey;
alter table workout_exercises add constraint workout_exercises_user_id_fkey
  foreign key (user_id) references app_users (id) on delete cascade;

alter table workout_sets drop constraint workout_sets_user_id_fkey;
alter table workout_sets add constraint workout_sets_user_id_fkey
  foreign key (user_id) references app_users (id) on delete cascade;

alter table diet_entries drop constraint diet_entries_user_id_fkey;
alter table diet_entries add constraint diet_entries_user_id_fkey
  foreign key (user_id) references app_users (id) on delete cascade;

-- goals: user_id is this table's PRIMARY KEY as well as its owner
-- column. Only the foreign key is touched here; the primary key is
-- untouched and unaffected.
alter table goals drop constraint goals_user_id_fkey;
alter table goals add constraint goals_user_id_fkey
  foreign key (user_id) references app_users (id) on delete cascade;

alter table daily_assessments drop constraint daily_assessments_user_id_fkey;
alter table daily_assessments add constraint daily_assessments_user_id_fkey
  foreign key (user_id) references app_users (id) on delete cascade;


-- ============================================================
-- Self-check: prove the end state before committing
-- ============================================================
--
-- Same reasoning as step 2's self-check: read the result, don't restate
-- the intent. A half-applied repoint would leave some data checked
-- against one list and some against another, and nothing would report it.

do $$
declare
  v_on_app_users int;
  v_on_auth      int;
begin
  select count(*) into v_on_app_users
  from pg_constraint c
  join pg_class t   on t.oid = c.conrelid
  join pg_class ref on ref.oid = c.confrelid
  where c.contype = 'f'
    and c.conname like '%\_user\_id\_fkey'
    and ref.relname = 'app_users'
    and t.relname in ('measurements', 'workouts', 'workout_exercises',
                      'workout_sets', 'diet_entries', 'goals', 'daily_assessments');

  if v_on_app_users <> 7 then
    raise exception
      'Repoint incomplete: expected 7 tables referencing app_users, found %.', v_on_app_users;
  end if;

  -- app_users' own link to auth.users must survive: it is what keeps the
  -- delete chain intact until Phase 5.
  select count(*) into v_on_auth
  from pg_constraint c
  join pg_class     t   on t.oid = c.conrelid
  join pg_class     ref on ref.oid = c.confrelid
  join pg_namespace rn  on rn.oid = ref.relnamespace
  where c.contype = 'f'
    and t.relname = 'app_users'
    and rn.nspname = 'auth'
    and ref.relname = 'users';

  if v_on_auth <> 1 then
    raise exception
      'app_users no longer references auth.users — the delete chain is broken. Expected 1, found %.', v_on_auth;
  end if;

  raise notice 'Repoint complete: 7 tables now reference app_users; delete chain intact.';
end;
$$;
