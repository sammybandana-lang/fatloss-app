-- Workouts imported from Hevy. Three tables (workout -> exercises -> sets),
-- each with user_id + RLS so a user can only ever touch their own rows.
-- Mirrors the isolation model used by the measurements table.

-- ============================================================
-- workouts: one row per workout session
-- ============================================================
create table workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  hevy_id text not null,                 -- Hevy's workout UUID; used for dedup on re-sync
  routine_id text,                       -- Hevy routine this came from (nullable)
  title text not null,
  description text,
  start_time timestamptz,
  end_time timestamptz,
  created_at timestamptz not null default now(),
  -- Re-importing the same Hevy workout must not create a duplicate.
  unique (user_id, hevy_id)
);

-- ============================================================
-- workout_exercises: one row per exercise within a workout
-- ============================================================
create table workout_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workout_id uuid not null references workouts (id) on delete cascade,
  exercise_template_id text,             -- Hevy's exercise template id
  superset_id text,                      -- Hevy superset grouping (nullable)
  title text not null,
  notes text,
  order_index int not null,              -- Hevy's "index": order within the workout
  unique (workout_id, order_index)
);

-- ============================================================
-- workout_sets: one row per set within an exercise
-- ============================================================
create table workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id uuid not null references workout_exercises (id) on delete cascade,
  set_index int not null,                -- Hevy's "index": order within the exercise
  set_type text,                         -- normal | warmup | dropset | failure
  weight_kg numeric,                     -- high precision from Hevy; round on display
  reps int,
  distance_meters numeric,
  duration_seconds int,
  rpe numeric,
  custom_metric numeric,
  unique (exercise_id, set_index)
);

-- ============================================================
-- Row-Level Security: enable + scope every operation to the owner
-- ============================================================
alter table workouts enable row level security;
alter table workout_exercises enable row level security;
alter table workout_sets enable row level security;

grant select, insert, update, delete on workouts to authenticated;
grant select, insert, update, delete on workout_exercises to authenticated;
grant select, insert, update, delete on workout_sets to authenticated;

-- workouts policies
create policy "own workouts - select" on workouts for select using ((select auth.uid()) = user_id);
create policy "own workouts - insert" on workouts for insert with check ((select auth.uid()) = user_id);
create policy "own workouts - update" on workouts for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own workouts - delete" on workouts for delete using ((select auth.uid()) = user_id);

-- workout_exercises policies
create policy "own exercises - select" on workout_exercises for select using ((select auth.uid()) = user_id);
create policy "own exercises - insert" on workout_exercises for insert with check ((select auth.uid()) = user_id);
create policy "own exercises - update" on workout_exercises for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own exercises - delete" on workout_exercises for delete using ((select auth.uid()) = user_id);

-- workout_sets policies
create policy "own sets - select" on workout_sets for select using ((select auth.uid()) = user_id);
create policy "own sets - insert" on workout_sets for insert with check ((select auth.uid()) = user_id);
create policy "own sets - update" on workout_sets for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own sets - delete" on workout_sets for delete using ((select auth.uid()) = user_id);

-- Helpful indexes for the joins the app and analysis layer will run.
create index workouts_user_start_idx on workouts (user_id, start_time desc);
create index workout_exercises_workout_idx on workout_exercises (workout_id);
create index workout_sets_exercise_idx on workout_sets (exercise_id);