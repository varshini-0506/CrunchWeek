-- =====================================================================
-- CrunchWeek: Supabase database for the scheduling engine
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once: a second run keeps all data.
--
-- What it does
--   1. Removes the unused tables from 0001_initial_schema.sql (they were never
--      written to; all of them had 0 rows).
--   2. Creates the tables the engine writes on every change: rooms, classes,
--      the timetable, Spectra venue requests and bookings, exams, changes,
--      and the audit log, plus the engine's full saved state.
--   3. Adds the database-level rules that make clashes impossible:
--      one room = one occupant per period, one teacher = one class per period,
--      one student group = one class per period, one exam per room per slot,
--      and no two venue bookings overlapping in the same room.
--   4. Turns on Row Level Security everywhere (nothing private is readable
--      with the public anon key) and enables Realtime on the live tables.
--   5. Seeds the five demo accounts.
-- =====================================================================

-- ---------------------------------------------------------------- 1. clean up 0001
drop table if exists public.notifications cascade;
drop table if exists public.disruptions cascade;
-- audit_log and exam_placements are reused below, so only drop the 0001 versions of them
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'audit_log' and column_name = 'entity') then
    drop table public.audit_log cascade;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'exam_placements' and column_name = 'version_id') then
    drop table public.exam_placements cascade;
  end if;
end $$;
drop table if exists public.booking_requests cascade;
drop table if exists public.room_slots cascade;
drop table if exists public.session_placements cascade;
drop table if exists public.timetable_versions cascade;
drop table if exists public.datasets cascade;
drop table if exists public.profiles cascade;
drop type if exists public.booking_status;
drop type if exists public.version_status;
drop type if exists public.app_role;

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------- 2. tables
-- Engine state: the whole working snapshot (the engine reloads from here on restart).
create table if not exists public.engine_state (
  id            text primary key,                 -- 'current'
  dataset_id    text not null,
  snapshot      jsonb not null,
  revision      bigint not null default 1,
  saved_at      timestamptz not null default now(),
  mirror_ok     boolean not null default true,    -- false if the tables below could not be refreshed
  mirror_error  text,
  mirrored_at   timestamptz
);

-- Demo sign-in accounts (the same five the web app and engine use).
create table if not exists public.app_users (
  username    text primary key,
  name        text not null,
  role        text not null check (role in ('admin','department_coordinator','faculty','club')),
  department  text,
  faculty_id  text,
  created_at  timestamptz not null default now()
);

-- Reference data from the dataset.
create table if not exists public.rooms (
  id            text primary key,
  name          text not null,
  building      text,
  type          text not null,
  capacity      int  not null check (capacity > 0),
  features      text[] not null default '{}',
  accessible    boolean not null default false,
  allowed_uses  text[] not null default '{}'
);

create table if not exists public.room_unavailability (
  room_id  text not null references public.rooms(id) on delete cascade,
  day      text not null check (day in ('MON','TUE','WED','THU','FRI','SAT')),
  period   smallint not null check (period between 1 and 13),
  reason   text,
  primary key (room_id, day, period)
);

create table if not exists public.faculty (
  id                 text primary key,
  name               text not null,
  department         text,
  max_hours_per_day  smallint not null default 4,
  needs_accessible   boolean not null default false,
  unavailable        jsonb not null default '[]',
  preferences        jsonb not null default '[]'
);

create table if not exists public.student_groups (
  id                text primary key,
  name              text not null,
  year              smallint,
  department        text,
  size              int not null check (size > 0),
  needs_accessible  boolean not null default false
);

create table if not exists public.courses (
  id              text primary key,
  title           text not null,
  department      text,
  year            smallint,
  lecture_hours   smallint not null default 0,
  tutorial_hours  smallint not null default 0,
  lab_blocks      smallint not null default 0
);

create table if not exists public.class_sessions (
  id                text primary key,
  course_id         text not null references public.courses(id) on delete cascade,
  kind              text not null check (kind in ('lecture','tutorial','lab')),
  groups            text[] not null,
  faculty_id        text not null references public.faculty(id) on delete cascade,
  size              int not null check (size > 0),
  duration          smallint not null check (duration between 1 and 4),
  room_types        text[] not null,
  needs_accessible  boolean not null default false,
  basket_slot       text,
  fixed_slot        jsonb
);

-- The timetable: where and when every class runs.
-- week = 'regular' (a normal week) or 'spectra' (Week 7, with fest moves applied).
create table if not exists public.timetable_slots (
  week          text not null check (week in ('regular','spectra')),
  session_id    text not null references public.class_sessions(id) on delete cascade,
  day           text not null check (day in ('MON','TUE','WED','THU','FRI')),
  start_period  smallint not null check (start_period between 1 and 9),
  end_period    smallint not null check (end_period between 1 and 9),
  room_id       text not null references public.rooms(id),
  moved_for     text,                         -- Spectra request that displaced this class
  primary key (week, session_id),
  check (end_period >= start_period),
  check (not (start_period <= 5 and end_period > 5))   -- never across lunch
);

-- ---- The clash locks. One row per (thing, day, period); the primary keys refuse a second occupant.
create table if not exists public.room_occupancy (
  week           text not null check (week in ('regular','spectra')),
  room_id        text not null references public.rooms(id),
  day            text not null check (day in ('MON','TUE','WED','THU','FRI')),
  period         smallint not null check (period between 1 and 13),
  occupant_type  text not null check (occupant_type in ('class','booking')),
  occupant_id    text not null,
  primary key (week, room_id, day, period),
  check (occupant_type <> 'class' or period <= 9)
);

create table if not exists public.faculty_occupancy (
  week        text not null check (week in ('regular','spectra')),
  faculty_id  text not null references public.faculty(id),
  day         text not null check (day in ('MON','TUE','WED','THU','FRI')),
  period      smallint not null check (period between 1 and 9),
  session_id  text not null,
  primary key (week, faculty_id, day, period)
);

-- Sessions in the same elective basket share one row (occupant_key = the basket), so a
-- group can sit one elective of a basket, but never two different things at once.
create table if not exists public.group_occupancy (
  week          text not null check (week in ('regular','spectra')),
  group_id      text not null,
  day           text not null check (day in ('MON','TUE','WED','THU','FRI')),
  period        smallint not null check (period between 1 and 13),
  occupant_key  text not null,
  primary key (week, group_id, day, period)
);

-- Spectra venue requests: from the dataset and made in the app.
create table if not exists public.venue_requests (
  id                    text primary key,
  source                text not null check (source in ('dataset','app')),
  state                 text not null check (state in ('decided','pending','cancelled','turned_down')),
  submitted_at          timestamptz not null,
  requester             text not null,
  requester_username    text,              -- demo account that sent it (app requests)
  role                  text not null,
  department            text,
  requested_category    text not null,
  effective_category    text not null,
  title                 text not null,
  attendance            int not null check (attendance > 0),
  duration_periods      smallint not null check (duration_periods > 0),
  windows               jsonb not null,
  room_types            text[] not null default '{}',
  needs                 text[] not null default '{}',
  requested_room        text,
  mandatory_for_groups  text[] not null default '{}',
  series_id             text,
  raw_text              text,
  decision_status       text check (decision_status in ('approved','alternative_offered','rejected')),
  decision              jsonb,
  explain               jsonb not null default '{}',
  confirmed_by          text,
  confirmed_at          timestamptz,
  constraint no_self_confirmation check (confirmed_by is null or confirmed_by is distinct from requester_username)
);

-- Rooms actually held for Spectra. The exclusion constraint is the hard guarantee:
-- two held bookings can never overlap in the same room on the same day.
create table if not exists public.venue_bookings (
  request_id    text primary key references public.venue_requests(id) on delete cascade,
  status        text not null check (status in ('approved','alternative_offered')),
  room_id       text not null references public.rooms(id),
  day           text not null check (day in ('MON','TUE','WED','THU','FRI')),
  start_period  smallint not null check (start_period between 1 and 13),
  end_period    smallint not null check (end_period between 1 and 13),
  periods       int4range generated always as (int4range(start_period, end_period, '[]')) stored,
  reason        text,
  confirmed     boolean not null default false,
  check (end_period >= start_period),
  constraint no_double_booking exclude using gist (room_id with =, day with =, periods with &&)
);

create table if not exists public.exam_placements (
  exam_id         text primary key,
  course_ids      text[] not null,
  groups          text[] not null,
  size            int not null,
  duration_hours  smallint not null,
  day             text not null check (day in ('MON','TUE','WED','THU','FRI','SAT')),
  session         text not null check (session in ('AM','PM')),
  rooms           text[] not null
);

-- One exam per room per exam slot.
create table if not exists public.exam_room_slots (
  day      text not null,
  session  text not null,
  room_id  text not null references public.rooms(id),
  exam_id  text not null references public.exam_placements(exam_id) on delete cascade,
  primary key (day, session, room_id)
);

-- Timetable change requests (disruptions, manual moves) and their outcome.
create table if not exists public.change_requests (
  id           text primary key,
  kind         text not null,
  status       text not null,          -- proposed, infeasible, invalid, applied, ...
  requested_by text,
  requested_at timestamptz,
  approved_by  text,
  approved_at  timestamptz,
  note         text,
  changes      jsonb not null default '[]',
  diff         jsonb,
  details      jsonb not null default '{}'
);

-- Append-only audit log. Rows are kept even after the engine trims its own copy.
create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  fingerprint  text not null unique,
  at           timestamptz not null,
  actor        text not null,
  action       text not null,
  detail       text not null,
  extra        jsonb not null default '{}'
);

-- ---------------------------------------------------------------- indexes
create index if not exists class_sessions_course   on public.class_sessions (course_id);
create index if not exists class_sessions_faculty  on public.class_sessions (faculty_id);
create index if not exists class_sessions_groups   on public.class_sessions using gin (groups);
create index if not exists timetable_slots_room    on public.timetable_slots (week, room_id, day);
create index if not exists timetable_slots_day     on public.timetable_slots (week, day, start_period);
create index if not exists room_occupancy_slot     on public.room_occupancy (week, day, period);
create index if not exists venue_requests_state    on public.venue_requests (state, effective_category);
create index if not exists venue_requests_user     on public.venue_requests (requester_username);
create index if not exists venue_bookings_room_day on public.venue_bookings (room_id, day);
create index if not exists change_requests_status  on public.change_requests (status);
create index if not exists audit_log_at            on public.audit_log (at desc);

-- ---------------------------------------------------------------- helper
-- Is a room free in a week between two periods? Example:
--   select public.room_is_free('AUD', 'spectra', 'MON', 4, 5);
create or replace function public.room_is_free(p_room text, p_week text, p_day text, p_from int, p_to int)
returns boolean
language sql stable
set search_path = ''
as $$
  select not exists (
    select 1 from public.room_occupancy o
    where o.room_id = p_room and o.week = p_week and o.day = p_day
      and o.period between p_from and p_to
  );
$$;

-- Which room is free, and who is in it, for every slot (handy in the Table Editor).
create or replace view public.room_schedule with (security_invoker = true) as
select o.week, o.day, o.period, o.room_id, r.name as room_name, o.occupant_type, o.occupant_id,
       coalesce(c.title, vr.title) as what
from public.room_occupancy o
join public.rooms r on r.id = o.room_id
left join public.class_sessions s on o.occupant_type = 'class' and s.id = o.occupant_id
left join public.courses c on c.id = s.course_id
left join public.venue_requests vr on o.occupant_type = 'booking' and vr.id = o.occupant_id;

-- ---------------------------------------------------------------- 4. row level security
-- The engine connects with the database password (DATABASE_URL), which bypasses RLS.
-- The public anon key can only read the published timetable and venue data.
do $$
declare t text;
begin
  foreach t in array array['engine_state','app_users','rooms','room_unavailability','faculty','student_groups',
    'courses','class_sessions','timetable_slots','room_occupancy','faculty_occupancy','group_occupancy',
    'venue_requests','venue_bookings','exam_placements','exam_room_slots','change_requests','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

drop policy if exists "public read" on public.rooms;
create policy "public read" on public.rooms for select to anon, authenticated using (true);
drop policy if exists "public read" on public.courses;
create policy "public read" on public.courses for select to anon, authenticated using (true);
drop policy if exists "public read" on public.student_groups;
create policy "public read" on public.student_groups for select to anon, authenticated using (true);
drop policy if exists "public read" on public.class_sessions;
create policy "public read" on public.class_sessions for select to anon, authenticated using (true);
drop policy if exists "public read" on public.timetable_slots;
create policy "public read" on public.timetable_slots for select to anon, authenticated using (true);
drop policy if exists "public read" on public.room_occupancy;
create policy "public read" on public.room_occupancy for select to anon, authenticated using (true);
drop policy if exists "public read" on public.venue_bookings;
create policy "public read" on public.venue_bookings for select to anon, authenticated using (true);
drop policy if exists "public read" on public.exam_placements;
create policy "public read" on public.exam_placements for select to anon, authenticated using (true);
-- Everything else (engine_state, app_users, faculty, requests, changes, audit_log) has no
-- policy, so the anon key gets nothing. Only the engine reads and writes them.

-- ---------------------------------------------------------------- realtime
do $$
declare t text;
begin
  foreach t in array array['timetable_slots','room_occupancy','venue_bookings','venue_requests','change_requests']
  loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then
  null;  -- no supabase_realtime publication (plain Postgres): skip
end $$;

-- ---------------------------------------------------------------- 5. seed data
insert into public.app_users (username, name, role, department, faculty_id) values
  ('admin',         'Registrar''s Office',         'admin',                  null,  null),
  ('dean',          'Dean, Student Affairs',       'admin',                  null,  null),
  ('coord.cse',     'CSE Department Coordinator',  'department_coordinator', 'CSE', null),
  ('F01',           'Dr. Ananya Mishra',           'faculty',                'CSE', 'F01'),
  ('club.robotics', 'Robotics Club',               'club',                   null,  null)
on conflict (username) do update
  set name = excluded.name, role = excluded.role, department = excluded.department, faculty_id = excluded.faculty_id;

-- Rooms, classes, the timetable, bookings and exams are filled by the engine the first
-- time it starts with DATABASE_URL set (it loads data/cit_public.json and the seeded
-- timetable). Check afterwards with:
--   select id, dataset_id, revision, saved_at, mirror_ok, mirror_error from public.engine_state;
--   select week, count(*) from public.timetable_slots group by week;
