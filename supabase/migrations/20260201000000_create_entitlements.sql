-- MIRAAI payment entitlement table.
-- One row per customer. Records a VERIFIED Razorpay payment that grants access
-- to the seven-day experience.
--
-- SECURITY MODEL:
--   * The browser uses the anon key + the customer's session, so RLS applies.
--   * The ONLY policy is SELECT (read your own entitlement). There are NO
--     insert/update/delete policies, so a customer can NEVER write their own
--     entitlement from the client — they cannot self-grant access.
--   * Entitlement rows are written exclusively by the server using the
--     service-role key (which bypasses RLS) AFTER verifying the Razorpay
--     payment signature, amount, currency and captured status.
--
-- Apply via Supabase Dashboard -> SQL Editor, or `supabase db push`.

create table if not exists entitlements (
  -- One entitlement per authenticated customer.
  customer_id uuid primary key
    references auth.users(id) on delete cascade,

  -- Whether access is currently granted.
  active boolean not null default false,

  -- Lifecycle status: created | paid | failed
  status text not null default 'created',

  -- Razorpay identifiers. razorpay_payment_id is UNIQUE so re-processing the
  -- same payment (duplicate callback / webhook) is idempotent.
  razorpay_order_id text,
  razorpay_payment_id text unique,

  -- Amount actually paid, in paise (₹79 = 7900). Recorded server-side; never
  -- trusted from the browser.
  amount_paise integer not null default 7900,
  currency text not null default 'INR',

  paid_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_entitlements_status on entitlements (status);

-- --- RLS: a customer can only READ their own entitlement, never write it. ---
alter table entitlements enable row level security;

create policy "Customers can read their own entitlement"
  on entitlements for select
  using (auth.uid() = customer_id);

-- Intentionally NO insert/update/delete policies: the client cannot grant or
-- alter access. Only the server (service-role key) writes entitlement rows.

-- --- Keep updated_at accurate on every change. ---
create or replace function entitlements_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_entitlements_updated_at on entitlements;
create trigger set_entitlements_updated_at
  before update on entitlements
  for each row
  execute function entitlements_set_updated_at();
