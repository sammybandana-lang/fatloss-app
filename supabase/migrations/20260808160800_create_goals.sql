-- Goals: one row per user (weight targets, macro targets, workout
-- frequency target). Data foundation the AI-assessment adapter will read
-- from in a later slice. user_id is the primary key because there is
-- exactly one goals row per user — saves go through an upsert, never a
-- second insert.

create table goals (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  weight_lbs_current numeric(5,1),
  weight_lbs_goal numeric(5,1),
  daily_calories_goal integer,
  daily_protein_g_goal integer,
  weekly_workout_goal integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Speed: find a user's goals row quickly (technically redundant with the
-- primary key's own index, but every table in this project is indexed on
-- its owner column as a hard rule — see CLAUDE.md).
create index goals_user_id_idx on goals (user_id);

-- Turn on the wall
alter table goals enable row level security;

-- Let logged-in users touch this table at all
grant select, insert, update, delete on table goals to authenticated;

-- Policy: you may only SEE your own goals
create policy "select own goals"
on goals for select
using ( (select auth.uid()) = user_id );

-- Policy: you may only ADD a goals row stamped as yours
create policy "insert own goals"
on goals for insert
with check ( (select auth.uid()) = user_id );

-- Policy: you may only EDIT your own goals
create policy "update own goals"
on goals for update
using ( (select auth.uid()) = user_id )
with check ( (select auth.uid()) = user_id );

-- Policy: you may only DELETE your own goals
create policy "delete own goals"
on goals for delete
using ( (select auth.uid()) = user_id );
