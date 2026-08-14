-- Azure migration, Phase 3, step 1. See ARCHITECTURE.md §10.4.
--
-- WHAT THIS IS FOR
--
-- This is the third and last thing the database borrows from Supabase:
-- the account name the app signs in with. Today the website reaches the
-- database through Supabase's web layer, which signs in as a role called
-- `authenticated`. Azure has no such role — we have to own it.
--
-- This creates `app_user`: the role the website will connect as once
-- Phase 3 replaces the Supabase client with a direct database connection.
--
-- WHY IT IS CREATED NOW AND NOT IN PHASE 2
--
-- Step 3 of Phase 2 deliberately deferred this, because nothing could
-- connect as it yet and an untestable role sitting in the schema is how
-- mistakes hide. That changes here: this role is created in the same step
-- as the code that uses it and the test that proves it behaves.
--
-- THE THING THIS ROLE MUST NOT BE ABLE TO DO
--
-- Two ways a database login can see around the walls:
--
--   1. BYPASSRLS — an attribute that exempts a role from row-level
--      security entirely. This is how Supabase's `service_role` works.
--      app_user must NOT have it, and the self-check below proves it.
--   2. Owning the table — in PostgreSQL an owner is exempt from its own
--      policies. Phase 2 step 2 already closed this with FORCE ROW LEVEL
--      SECURITY on all 8 tables, but app_user is additionally not an
--      owner of anything, so both doors are shut rather than one.
--
-- Getting this wrong would not raise an error. The app would work
-- perfectly and the walls would simply not be there. That is why the
-- check at the bottom is part of the migration rather than a note in a
-- document.
--
-- NO PASSWORD IS SET HERE, ON PURPOSE
--
-- A password in a tracked migration file is a secret committed to the
-- repository, which CLAUDE.md forbids outright. The role is created able
-- to log in but with no password, so it cannot yet be used. Setting the
-- password is a manual step done outside version control — see the
-- instructions accompanying this migration.
--
-- WHAT IS NOT HERE
--
-- `app_job`, the background job's eventual login, is deliberately absent.
-- It raises a real design question — whether it bypasses the walls the
-- way `service_role` does today, or is held to them like everything else
-- — and that question deserves its own decision rather than being
-- settled quietly inside a migration about something else. It arrives
-- with the job's own conversion.
--
-- REVERSING THIS FILE
--
--   revoke all on all tables in schema public from app_user;
--   revoke all on schema public from app_user;
--   drop role app_user;


-- ============================================================
-- The role
-- ============================================================
--
-- Guarded so re-running is harmless. Roles are cluster-level objects in
-- PostgreSQL, not schema-level, so unlike a table they are not covered by
-- the migration's transaction in the way you might assume — the guard is
-- what makes this safe to re-run rather than a source of "role already
-- exists" failures.
--
-- LOGIN, because it must be able to connect. Nothing else: no SUPERUSER,
-- no CREATEDB, no CREATEROLE, and above all no BYPASSRLS.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user with login;
  end if;
end;
$$;


-- ============================================================
-- Privileges — deliberately the same shape as `authenticated`
-- ============================================================
--
-- Mirrors exactly what the existing migrations grant `authenticated`, so
-- that swapping the connection underneath the app changes how it
-- connects and nothing about what it is allowed to reach. Any difference
-- here would show up as a mysterious permission error in one corner of
-- the app rather than as an obvious failure.
--
-- Note the two systems at work: these GRANTs decide which TABLES the role
-- may touch at all; the RLS policies decide which ROWS of them it sees.
-- Both are required. 20260810153000 exists because that distinction was
-- missed once already.

grant usage on schema public to app_user;

-- Full owner-scoped CRUD, exactly as `authenticated` has.
grant select, insert, update, delete on measurements      to app_user;
grant select, insert, update, delete on workouts          to app_user;
grant select, insert, update, delete on workout_exercises to app_user;
grant select, insert, update, delete on workout_sets      to app_user;
grant select, insert, update, delete on diet_entries      to app_user;
grant select, insert, update, delete on goals             to app_user;

-- Read-only, exactly as `authenticated` has: the background job is the
-- only writer of assessments, and app_users is maintained by the signup
-- trigger, never by the app.
grant select on daily_assessments to app_user;
grant select on app_users         to app_user;

-- The identity function every policy calls.
grant execute on function app_current_user_id() to app_user;

-- Deliberately NOT granted: anything on future tables. No
-- `alter default privileges` is set for this role, so a table created
-- later is unreachable until someone grants it explicitly. That is the
-- "start locked, then open up" rule from CLAUDE.md applied to the role
-- rather than to the table.


-- ============================================================
-- Self-check: prove the role cannot see around the walls
-- ============================================================

do $$
declare
  v_bypass  boolean;
  v_super   boolean;
  v_owns    int;
  v_pg_byp  boolean;
begin
  select rolbypassrls, rolsuper into v_bypass, v_super
  from pg_roles where rolname = 'app_user';

  if v_bypass then
    raise exception
      'app_user has BYPASSRLS. It would ignore every row-level policy in this database. Refusing to create it.';
  end if;

  if v_super then
    raise exception
      'app_user is a superuser. Refusing to create it.';
  end if;

  -- An owner is exempt from its own policies. FORCE ROW LEVEL SECURITY
  -- (Phase 2 step 2) already covers this, but app_user should not be an
  -- owner regardless — defence in depth, not one control doing two jobs.
  select count(*) into v_owns
  from pg_class c
  join pg_roles r on r.oid = c.relowner
  where r.rolname = 'app_user'
    and c.relkind = 'r';

  if v_owns > 0 then
    raise exception
      'app_user owns % table(s) and would be exempt from their policies.', v_owns;
  end if;

  raise notice 'app_user created: no BYPASSRLS, not a superuser, owns no tables.';

  -- Diagnostic only, not a failure. Records whether the `postgres` role
  -- this migration runs as can itself bypass RLS. If it can, then any
  -- direct connection made as `postgres` sees ALL rows regardless of
  -- policy — which is exactly why the app must connect as app_user and
  -- never as postgres. Worth having in the migration log.
  select rolbypassrls into v_pg_byp from pg_roles where rolname = 'postgres';
  raise notice 'Diagnostic — role "postgres" rolbypassrls = %. The app must never connect as this role.', v_pg_byp;
end;
$$;
