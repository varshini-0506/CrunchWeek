-- CrunchWeek core schema (applied to Supabase project "crunchweek")
create type public.app_role as enum ('admin', 'department_coordinator', 'faculty', 'club');
create type public.version_status as enum ('draft', 'pending_approval', 'active', 'rejected', 'superseded');
create type public.booking_status as enum ('pending', 'approved', 'rejected', 'alternative_offered', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.app_role not null,
  department text,
  faculty_id text,
  club_name text,
  created_at timestamptz not null default now()
);

create table public.datasets (
  id bigint generated always as identity primary key,
  dataset_id text not null,
  payload jsonb not null,
  is_active boolean not null default false,
  loaded_by uuid references public.profiles(id),
  loaded_at timestamptz not null default now()
);
create unique index datasets_one_active on public.datasets (is_active) where is_active;

create table public.timetable_versions (
  id bigint generated always as identity primary key,
  dataset_ref bigint not null references public.datasets(id) on delete cascade,
  parent_id bigint references public.timetable_versions(id),
  status public.version_status not null default 'draft',
  source text not null,
  summary jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  constraint no_self_approval check (approved_by is null or approved_by is distinct from created_by)
);
create unique index timetable_one_active on public.timetable_versions (dataset_ref) where status = 'active';

create table public.session_placements (
  version_id bigint not null references public.timetable_versions(id) on delete cascade,
  session_id text not null,
  day text not null check (day in ('MON','TUE','WED','THU','FRI')),
  start_period smallint not null check (start_period between 1 and 9),
  room_id text not null,
  primary key (version_id, session_id)
);

-- Room-slot lock: the database refuses a second occupant, even under concurrent writes.
create table public.room_slots (
  version_id bigint not null references public.timetable_versions(id) on delete cascade,
  week text not null default 'regular',
  room_id text not null,
  day text not null,
  period smallint not null check (period between 1 and 13),
  occupant_type text not null check (occupant_type in ('session','booking','hold')),
  occupant_id text not null,
  primary key (version_id, week, room_id, day, period)
);

create table public.booking_requests (
  id bigint generated always as identity primary key,
  dataset_ref bigint references public.datasets(id) on delete cascade,
  request_code text not null,
  requester_id uuid references public.profiles(id),
  requester_name text not null,
  role public.app_role not null,
  department text,
  requested_category text not null,
  effective_category text not null,
  title text not null,
  attendance int not null check (attendance > 0),
  duration_periods smallint not null check (duration_periods > 0),
  windows jsonb not null,
  room_types text[] not null,
  needs text[] not null default '{}',
  requested_room text,
  mandatory_for_groups text[] not null default '{}',
  series_id text,
  raw_text text,
  parsed_by_ai boolean not null default false,
  submitted_at timestamptz not null default now(),
  status public.booking_status not null default 'pending',
  decision jsonb,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  unique (dataset_ref, request_code),
  constraint no_self_decision check (decided_by is null or decided_by is distinct from requester_id)
);

create table public.exam_placements (
  version_id bigint not null references public.timetable_versions(id) on delete cascade,
  exam_id text not null,
  day text not null check (day in ('MON','TUE','WED','THU','FRI','SAT')),
  session text not null check (session in ('AM','PM')),
  rooms text[] not null,
  primary key (version_id, exam_id)
);

create table public.disruptions (
  id bigint generated always as identity primary key,
  dataset_ref bigint not null references public.datasets(id) on delete cascade,
  payload jsonb not null,
  proposed_version bigint references public.timetable_versions(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected','infeasible')),
  conflicts jsonb,
  created_by uuid references public.profiles(id),
  decided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint no_self_approval check (decided_by is null or decided_by is distinct from created_by)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid references public.profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}',
  at timestamptz not null default now()
);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index booking_requests_status on public.booking_requests (status);
create index notifications_user on public.notifications (user_id, read_at);
create index audit_log_at on public.audit_log (at desc);

alter table public.profiles enable row level security;
alter table public.datasets enable row level security;
alter table public.timetable_versions enable row level security;
alter table public.session_placements enable row level security;
alter table public.room_slots enable row level security;
alter table public.booking_requests enable row level security;
alter table public.exam_placements enable row level security;
alter table public.disruptions enable row level security;
alter table public.audit_log enable row level security;
alter table public.notifications enable row level security;

create policy "read profiles" on public.profiles for select to authenticated using (true);
create policy "read timetable versions" on public.timetable_versions for select to authenticated using (true);
create policy "read placements" on public.session_placements for select to authenticated using (true);
create policy "read room slots" on public.room_slots for select to authenticated using (true);
create policy "read bookings" on public.booking_requests for select to authenticated using (true);
create policy "read exams" on public.exam_placements for select to authenticated using (true);
create policy "read disruptions" on public.disruptions for select to authenticated using (true);
create policy "own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "admins read audit" on public.audit_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create policy "admins read datasets" on public.datasets for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

alter publication supabase_realtime add table public.booking_requests, public.timetable_versions, public.disruptions, public.notifications, public.room_slots;
