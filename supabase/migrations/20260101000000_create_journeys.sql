-- MIRAAI customer journey table.
-- Apply via Supabase Dashboard -> SQL Editor, or `supabase db push`.

create table if not exists journeys (
  id uuid primary key default gen_random_uuid(),

  -- Ownership: every journey belongs to exactly one authenticated user.
  customer_id uuid not null
    references auth.users(id) on delete cascade,

  -- Profile fields (match the requested customer fields).
  name text not null default '',
  email text,

  -- Journey lifecycle.
  journey_start_date date not null default current_date,
  current_day integer not null default 1
    check (current_day between 1 and 7),
  completed_days integer[] not null default '{}',

  -- Per-day inputs + AI output (full column list as requested).
  day_1_responses jsonb not null default '{}',
  day_1_ai_output jsonb not null default '{}',
  day_2_responses jsonb not null default '{}',
  day_2_ai_output jsonb not null default '{}',
  day_3_responses jsonb not null default '{}',
  day_3_ai_output jsonb not null default '{}',
  day_4_responses jsonb not null default '{}',
  day_4_ai_output jsonb not null default '{}',
  day_5_responses jsonb not null default '{}',
  day_5_ai_output jsonb not null default '{}',
  day_6_responses jsonb not null default '{}',
  day_6_ai_output jsonb not null default '{}',
  day_7_responses jsonb not null default '{}',
  day_7_report jsonb not null default '{}',

  -- Audit timestamps.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_journeys_customer_id
  on journeys (customer_id);

-- --- RLS: one customer can NEVER read or write another customer's journey. ---
alter table journeys enable row level security;

create policy "Users can view their own journey"
  on journeys for select
  using (auth.uid() = customer_id);

create policy "Users can insert their own journey"
  on journeys for insert
  with check (auth.uid() = customer_id);

create policy "Users can update their own journey"
  on journeys for update
  using (auth.uid() = customer_id)
  with check (auth.uid() = customer_id);

-- --- Keep updated_at accurate on every change. ---
create function journeys_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_journeys_updated_at
  before update on journeys
  for each row
  execute function journeys_set_updated_at();
