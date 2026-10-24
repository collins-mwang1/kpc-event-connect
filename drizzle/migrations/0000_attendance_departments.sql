create type public.checkin_method as enum ('DESK_SEARCH', 'DESK_CODE', 'SELF');

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null,
  description text,
  source_field_key text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, name)
);

create table public.department_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  registration_id uuid not null references public.registrations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (department_id, registration_id)
);

create table public.attendance_checkins (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  registration_id uuid not null references public.registrations(id) on delete cascade,
  desk_id uuid references public.registration_desks(id) on delete set null,
  method public.checkin_method not null,
  checkin_date date not null default (now() at time zone 'utc')::date,
  checked_in_at timestamptz not null default now()
);

-- One clock-in per person per calendar day per context (event or general).
create unique index attendance_checkins_person_day
  on public.attendance_checkins (
    registration_id,
    coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid),
    checkin_date
  );
create index attendance_checkins_space_day on public.attendance_checkins (space_id, checkin_date desc);
create index attendance_checkins_registration_idx on public.attendance_checkins (registration_id);
create index department_members_registration_idx on public.department_members (registration_id);

grant select on public.departments to authenticated;
grant select on public.department_members to authenticated;
grant select on public.attendance_checkins to authenticated;
grant all on public.departments to service_role;
grant all on public.department_members to service_role;
grant all on public.attendance_checkins to service_role;

alter table public.departments enable row level security;
alter table public.department_members enable row level security;
alter table public.attendance_checkins enable row level security;

create policy "departments_member_read" on public.departments for select to authenticated
  using (private.is_space_member(space_id, auth.uid()));
create policy "department_members_member_read" on public.department_members for select to authenticated
  using (private.is_space_member(space_id, auth.uid()));
create policy "attendance_checkins_member_read" on public.attendance_checkins for select to authenticated
  using (private.is_space_member(space_id, auth.uid()));

create trigger departments_set_updated_at before update on public.departments
  for each row execute function public.set_updated_at();

comment on table public.attendance_checkins is 'Clock-in records; writes happen only through authenticated server functions after membership checks - no Data API write policies, by design.';
comment on table public.departments is 'Departments within a space; source_field_key optionally derives membership from a registration field value matching the department name.';
