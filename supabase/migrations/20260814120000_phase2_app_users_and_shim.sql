-- Azure migration, Phase 2, step 1 of 3. See ARCHITECTURE.md §10.4.
--
-- WHAT THIS IS FOR
--
-- Three things in this database only exist because it is Supabase:
--
--   1. auth.uid()  — the function every RLS policy asks "who is asking?"
--   2. auth.users  — the hidden table every user_id column points at
--   3. the role names `authenticated` / `service_role`
--
-- Azure Database for PostgreSQL has none of them. Everything else in this
-- schema — the tables, the columns, the CHECK constraints, the indexes,
-- and the RLS policies themselves — is ordinary PostgreSQL and moves
-- across untouched.
--
-- So the plan is to replace those three, one at a time, WHILE STILL ON
-- SUPABASE, where the two-user isolation test can prove the replacement
-- works before anything moves host. Finding out the shim was wrong after
-- the move — with a new host and a new login system in play — is exactly
-- the debugging session this ordering avoids.
--
-- THIS MIGRATION IS ADDITIVE ONLY. It adds a table and a function. It does
-- not alter a single existing table, policy, default, or grant, so the
-- app's behaviour after it runs is byte-for-byte what it was before.
-- Steps 2 and 3 (repointing the policies, then the foreign keys and roles)
-- are separate migrations, reviewed separately.
--
--   step 1 (this file)  app_users + app_current_user_id(), both unused
--   step 2              policies and column defaults move onto the shim
--   step 3              foreign keys repoint, app roles, FORCE RLS
--
-- Reversing this file: drop the trigger, the function, and the table. No
-- existing data is read, written, or moved by it.


-- ============================================================
-- app_users — our own copy of "who has an account"
-- ============================================================
--
-- Replaces auth.users. Deliberately keyed on the SAME uuid Supabase
-- already issued, which is what makes this cheap: every existing
-- user_id value in every table stays exactly as it is. Nothing is
-- rewritten, so step 3 can repoint the foreign keys without touching a
-- single row of data.
--
-- `references auth.users` is TEMPORARY, and is what keeps the delete
-- chain intact during the transition: deleting a Supabase auth user
-- still cascades to this table, and from here on to the data tables once
-- step 3 repoints them. That reference is dropped at Phase 5, when the
-- new identity provider takes over and this table stands alone.
--
-- external_subject is the claim the future identity provider (Entra
-- External ID) will hand us. Null until Phase 5; unique so two accounts
-- can never map to the same external login.

create table app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  external_subject text unique,
  created_at timestamptz not null default now()
);

create index app_users_external_subject_idx on app_users (external_subject);

-- Every table in this project is indexed on its owner column as a hard
-- rule (CLAUDE.md). Here that column IS the primary key, so its index
-- already exists — noted so the omission reads as deliberate.


-- ============================================================
-- Backfill, then keep it in step
-- ============================================================

insert into app_users (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Supabase creates auth.users rows through its own signup flow, which no
-- migration or app code here controls. This trigger is what stops
-- app_users drifting out of date between now and Phase 5, including for
-- the throwaway accounts the isolation tests sign up on every run.
--
-- SECURITY DEFINER because the signup path runs as a role with no rights
-- on app_users. search_path is pinned, per the same reasoning as every
-- other definer function in this project.
--
-- This trigger is Supabase-specific and is DELETED at Phase 5. It has no
-- Azure equivalent and needs none — by then the identity provider's
-- callback writes this row.

create or replace function sync_app_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into app_users (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger trg_sync_app_user
after insert or update of email on auth.users
for each row execute function sync_app_user();


-- ============================================================
-- app_current_user_id() — the replacement for auth.uid()
-- ============================================================
--
-- Returns the id of whoever is asking, from whichever of the two
-- mechanisms is in play:
--
--   * TODAY (Supabase + PostgREST): auth.uid(), read from the verified
--     JWT. Unchanged from how every policy works right now.
--
--   * FROM PHASE 3 (node-postgres): a per-transaction setting the server
--     sets from the verified session — `set local app.current_user_id`.
--     SET LOCAL, never SET, so the value dies with the transaction and a
--     pooled connection can never carry one person's identity into the
--     next request.
--
-- ORDER MATTERS, and it is auth.uid() FIRST on purpose. During the
-- transition auth.uid() is the real source of truth, so it must win. If
-- the setting were checked first, anyone who found a way to set that GUC
-- could shadow their own verified identity — a self-inflicted
-- impersonation hole, for no benefit. Once Phase 5 removes Supabase Auth,
-- auth.uid() is dropped from this function and the setting is the only
-- source.
--
-- Both branches return NULL rather than raising when there is no caller,
-- and NULL never equals a user_id, so an unidentified connection sees
-- ZERO rows rather than all of them. That is the fail-closed property the
-- entire isolation guarantee rests on, and it is what §10.7's first test
-- exists to prove.
--
-- NOTE: lives in `public`, not an `app` schema, so PostgREST can expose
-- it to the tests via .rpc() during the transition. ARCHITECTURE.md
-- §10.2 sketched it as app.current_user_id(); this is that function,
-- renamed to be reachable and testable today. It moves host unchanged.

create or replace function app_current_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  v_id uuid;
begin
  -- auth.uid() disappears with Supabase. Wrapped so that this function
  -- keeps working the moment it does, rather than raising and taking
  -- every policy down with it.
  begin
    v_id := auth.uid();
  exception when others then
    v_id := null;
  end;

  if v_id is not null then
    return v_id;
  end if;

  return nullif(current_setting('app.current_user_id', true), '')::uuid;
end;
$$;

revoke all on function app_current_user_id() from public;
grant execute on function app_current_user_id() to authenticated, anon, service_role;


-- ============================================================
-- Row-Level Security on app_users
-- ============================================================
--
-- Turning the wall on is part of creating the table, never a later task
-- (CLAUDE.md). This table holds an email address per account, so the same
-- owner-only rule applies as everywhere else.
--
-- Start locked, open only what is needed: SELECT for the owner, and
-- nothing else for anyone. No insert/update/delete policy exists for any
-- role, so those operations are denied regardless of any GRANT issued
-- later. The only write paths are the trigger above and the service role.

alter table app_users enable row level security;

grant select on app_users to authenticated;

create policy "select own app_user" on app_users
  for select using ((select auth.uid()) = id);

-- The background job reads this table from Phase 3 onward, when it stops
-- resolving users through Supabase's auth admin API. Read-only: the job
-- has no reason to create or destroy accounts, so it cannot — the same
-- least-privilege reasoning as 20260810153000.
grant select on app_users to service_role;
