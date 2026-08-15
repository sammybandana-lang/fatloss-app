-- Azure migration, Phase 3, step 2. See ARCHITECTURE.md §10.4.
--
-- The background job's own database login.
--
-- WHAT THIS REPLACES, AND WHY IT IS BETTER
--
-- Today the noon job connects with Supabase's `service_role` key, which
-- ignores row-level security entirely. lib/supabase/service.ts says so in
-- its own docstring: "There is no database safety net here; the filters
-- in the calling code are the only thing keeping users apart."
--
-- That is the one credential where a leak equals total compromise
-- (ARCHITECTURE.md §4). `app_job` is not that. It has NO bypass powers,
-- so the database still checks every row it touches, and the job is
-- scoped to a single user by the same mechanism that scopes the website.
-- Hand-written user_id filters stop being the only thing standing
-- between two people's health data.
--
-- WHY A SEPARATE ROLE RATHER THAN REUSING app_user
--
-- Only one difference matters: the job writes `daily_assessments` and the
-- website must not. Those rows hold LLM-authored text that gets emailed
-- to a trainer, and "the job is the only writer" is a deliberate property
-- of the design (20260810143000). Granting the website that write to
-- avoid creating a second role would quietly hand the user the ability to
-- author their own assessment.
--
-- WHY THIS MIGRATION IS SHORT
--
-- Every policy on measurements, workouts, workout_exercises,
-- workout_sets, diet_entries, goals and app_users was written WITHOUT a
-- `TO` clause, which in PostgreSQL means it applies to every role. So
-- app_job inherits owner-scoping on all of them for free, and only needs
-- the table GRANTs below.
--
-- `daily_assessments` is the exception: its policy names `to
-- authenticated` explicitly, so app_job matches nothing there and needs
-- its own rules. Those are the three policies at the bottom.
--
-- No password is set here — that would be a secret in the repository.
--
-- REVERSING THIS FILE
--
--   drop policy "job reads assessments"   on daily_assessments;
--   drop policy "job writes assessments"  on daily_assessments;
--   drop policy "job updates assessments" on daily_assessments;
--   revoke all on all tables in schema public from app_job;
--   revoke all on schema public from app_job;
--   drop role app_job;


-- ============================================================
-- The role
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_job') then
    create role app_job with login;
  end if;
end;
$$;

grant usage on schema public to app_job;


-- ============================================================
-- Privileges — mirroring 20260810153000, which set these for
-- service_role and explained the reasoning
-- ============================================================
--
-- Least privilege, deliberately, quoting that migration's own rules:
--   * No DELETE anywhere. The job reads, syncs and appends — it has no
--     reason to destroy data, so it cannot.
--   * Read-only on goals and measurements, which the job only reads.
--   * Nothing is granted that the job does not use.

grant select on goals        to app_job;
grant select on measurements to app_job;
grant select on app_users    to app_job;

-- Synced from LoseIt and Hevy: read, append, and update on re-sync.
grant select, insert, update on diet_entries      to app_job;
grant select, insert, update on workouts          to app_job;
grant select, insert, update on workout_exercises to app_job;
grant select, insert, update on workout_sets      to app_job;

-- The job's own table: it writes the assessment, then stamps sent_at.
grant select, insert, update on daily_assessments to app_job;

grant execute on function app_current_user_id() to app_job;


-- ============================================================
-- daily_assessments — the only table needing new policies
-- ============================================================
--
-- Scoped to the user the job is currently processing, exactly like every
-- other policy in this database. The job stamps that identity onto its
-- transaction (lib/db withJob), so even a job that looped over the wrong
-- user list could not write a row onto somebody it had not stamped.
--
-- No DELETE policy, matching the absent DELETE grant — an assessment that
-- was emailed to a trainer should not be removable by the thing that
-- sent it.

create policy "job reads assessments" on daily_assessments
  for select to app_job
  using ((select app_current_user_id()) = user_id);

create policy "job writes assessments" on daily_assessments
  for insert to app_job
  with check ((select app_current_user_id()) = user_id);

create policy "job updates assessments" on daily_assessments
  for update to app_job
  using ((select app_current_user_id()) = user_id)
  with check ((select app_current_user_id()) = user_id);


-- ============================================================
-- Self-check
-- ============================================================

do $$
declare
  v_bypass boolean;
  v_super  boolean;
  v_owns   int;
begin
  select rolbypassrls, rolsuper into v_bypass, v_super
  from pg_roles where rolname = 'app_job';

  -- The entire point of this role. If it could bypass row-level
  -- security it would be service_role with a different name, and the
  -- job would be back to relying on its own filters being correct.
  if v_bypass then
    raise exception
      'app_job has BYPASSRLS, which defeats the reason it exists. Refusing to create it.';
  end if;

  if v_super then
    raise exception 'app_job is a superuser. Refusing to create it.';
  end if;

  select count(*) into v_owns
  from pg_class c
  join pg_roles r on r.oid = c.relowner
  where r.rolname = 'app_job' and c.relkind = 'r';

  if v_owns > 0 then
    raise exception 'app_job owns % table(s) and would be exempt from their policies.', v_owns;
  end if;

  -- No DELETE anywhere, per 20260810153000's stated invariant.
  if exists (
    select 1 from information_schema.role_table_grants
    where grantee = 'app_job' and privilege_type = 'DELETE'
  ) then
    raise exception 'app_job has a DELETE grant. The job has no reason to destroy data.';
  end if;

  raise notice 'app_job created: no BYPASSRLS, no DELETE, owns no tables.';
end;
$$;
