-- Makes `measurements` delete with its owner, like every other table here.
--
-- `measurements` was the first table written, before the pattern settled,
-- and its foreign key was declared without `on delete cascade`:
--
--   user_id uuid not null references auth.users (id) default auth.uid()
--
-- diet_entries, workouts, workout_exercises, workout_sets, goals and
-- daily_assessments all cascade. Only this one does not.
--
-- The effect was that deleting any user who had ever recorded a weight
-- failed outright with:
--
--   23503: update or delete on table "users" violates foreign key
--   constraint "measurements_user_id_fkey" on table "measurements"
--
-- That blocks a genuine "delete my account" request, not just test
-- cleanup. This migration changes only the delete behaviour of the
-- constraint — no rows are read, written, or removed by it.

alter table measurements
  drop constraint measurements_user_id_fkey;

alter table measurements
  add constraint measurements_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;
