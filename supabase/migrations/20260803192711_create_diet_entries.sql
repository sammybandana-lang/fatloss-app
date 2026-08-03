-- LoseIt diet entries: one row per logged food item, parsed from the daily
-- CSV attachment. user_id + RLS scope every row to its owner, same isolation
-- model as measurements and workouts. Macro columns are nullable because
-- LoseIt reports "n/a" for missing nutrients (converted to NULL at parse time).

create table diet_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_date date not null,              -- CSV "Date"
  name text not null,                    -- CSV "Name"
  food_type text,                        -- CSV "Type" (the meal, e.g. "Meal 2 12pm")
  quantity numeric,                      -- CSV "Quantity"
  units text,                            -- CSV "Units"
  calories numeric,                      -- CSV "Calories"
  fat_g numeric,                         -- CSV "Fat (g)"
  protein_g numeric,                     -- CSV "Protein (g)"
  carbs_g numeric,                       -- CSV "Carbohydrates (g)"
  saturated_fat_g numeric,               -- CSV "Saturated Fat (g)"
  sugars_g numeric,                      -- CSV "Sugars (g)"
  fiber_g numeric,                       -- CSV "Fiber (g)"
  cholesterol_mg numeric,                -- CSV "Cholesterol (mg)"
  sodium_mg numeric,                     -- CSV "Sodium (mg)"
  created_at timestamptz not null default now(),
  -- Dedup key: re-ingesting the same daily report must not double-insert.
  -- Identifies a specific logged food on a specific day. Not bulletproof
  -- (logging the identical food twice in one day would collide) — acceptable
  -- tradeoff for a daily report; revisit if it bites.
  unique (user_id, entry_date, name, food_type, calories)
);

alter table diet_entries enable row level security;

grant select, insert, update, delete on diet_entries to authenticated;

create policy "own diet - select" on diet_entries for select using ((select auth.uid()) = user_id);
create policy "own diet - insert" on diet_entries for insert with check ((select auth.uid()) = user_id);
create policy "own diet - update" on diet_entries for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own diet - delete" on diet_entries for delete using ((select auth.uid()) = user_id);

create index diet_entries_user_date_idx on diet_entries (user_id, entry_date desc);