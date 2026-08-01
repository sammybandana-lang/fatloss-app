-- Full measurements table for the fat-loss tracker

create table measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) default auth.uid(),
  measured_at date not null default current_date,
  weight_lbs   numeric check (weight_lbs   > 0   and weight_lbs   < 1500),
  body_fat_pct numeric check (body_fat_pct >= 0  and body_fat_pct <= 100),
  waist_in     numeric check (waist_in     > 0   and waist_in     < 100),
  hips_in      numeric check (hips_in      > 0   and hips_in      < 100),
  neck_in      numeric check (neck_in      > 0   and neck_in      < 100),
  created_at timestamptz not null default now()
);

-- Speed: find a user's rows quickly
create index measurements_user_id_idx on measurements (user_id);

-- Turn on the wall
alter table measurements enable row level security;

-- Let logged-in users touch this table at all
grant select, insert, update, delete on table measurements to authenticated;

-- Policy: you may only SEE your own rows
create policy "select own measurements"
on measurements for select
using ( (select auth.uid()) = user_id );

-- Policy: you may only ADD rows stamped as yours
create policy "insert own measurements"
on measurements for insert
with check ( (select auth.uid()) = user_id );

-- Policy: you may only EDIT your own rows
create policy "update own measurements"
on measurements for update
using ( (select auth.uid()) = user_id )
with check ( (select auth.uid()) = user_id );

-- Policy: you may only DELETE your own rows
create policy "delete own measurements"
on measurements for delete
using ( (select auth.uid()) = user_id );