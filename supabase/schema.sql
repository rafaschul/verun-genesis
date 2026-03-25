-- Verun Genesis — Supabase Schema
-- Kite's SQL (25.03.2026) — production-ready
-- Run in Supabase SQL Editor

create extension if not exists pgcrypto;

-- ===== ENUMS =====
do $$ begin
  create type agent_tier as enum ('wallet', 'identified');
  exception when duplicate_object then null;
end $$;

do $$ begin
  create type claim_role as enum ('genesis_agent', 'genesis_validator');
  exception when duplicate_object then null;
end $$;

do $$ begin
  create type claim_status as enum ('active', 'revoked');
  exception when duplicate_object then null;
end $$;

-- ===== AGENTS =====
create table if not exists public.agents (
  id              uuid primary key default gen_random_uuid(),
  address         text not null,
  address_norm    text not null,           -- lowercased / normalized
  chain           text not null check (chain in ('stellar', 'evm')),
  tier            agent_tier not null default 'wallet',
  score           int not null default 200 check (score >= 0 and score <= 1000),
  wallet_verified boolean not null default false,
  github_url      text,
  endpoint_url    text,
  invited         boolean not null default false,
  invited_by      text,
  registered_ip   inet,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (address_norm)
);

create index if not exists idx_agents_chain on public.agents(chain);
create index if not exists idx_agents_score on public.agents(score);

-- ===== CLAIMS =====
create table if not exists public.claims (
  id                  uuid primary key default gen_random_uuid(),
  claim_seq           bigint generated always as identity unique,
  claim_id            text unique,         -- vga-0001 style (set by trigger)
  agent_id            uuid not null references public.agents(id) on delete cascade,
  role                claim_role not null default 'genesis_agent',
  founding_score      int not null default 350 check (founding_score between 0 and 1000),
  status              claim_status not null default 'active',
  stellar_tx_hash     text,
  stellar_explorer_url text,
  certificate_json    jsonb,
  certificate_pdf_url text,
  valid_from          date not null default date '2026-06-01',
  created_at          timestamptz not null default now()
);

create index if not exists idx_claims_agent_id  on public.claims(agent_id);
create index if not exists idx_claims_tx_hash   on public.claims(stellar_tx_hash);

-- one active claim per agent
create unique index if not exists uq_claims_one_active_per_agent
  on public.claims(agent_id)
  where status = 'active';

-- ===== INVITE CODES =====
create table if not exists public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  created_by  text,
  max_uses    int not null default 1 check (max_uses > 0),
  used_count  int not null default 0 check (used_count >= 0),
  active      boolean not null default true,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ===== RATE LIMITS =====
create table if not exists public.rate_limits (
  id            uuid primary key default gen_random_uuid(),
  ip            inet not null,
  endpoint      text not null,
  window_start  timestamptz not null,
  request_count int not null default 1 check (request_count >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (ip, endpoint, window_start)
);

create index if not exists idx_rate_limits_lookup
  on public.rate_limits(ip, endpoint, window_start desc);

-- ===== UPDATED_AT trigger =====
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_agents_updated_at on public.agents;
create trigger trg_agents_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

drop trigger if exists trg_rate_limits_updated_at on public.rate_limits;
create trigger trg_rate_limits_updated_at
  before update on public.rate_limits
  for each row execute function public.set_updated_at();

-- ===== claim_id auto-format trigger (vga-0001...) =====
create or replace function public.set_claim_id()
returns trigger as $$
begin
  if new.claim_id is null then
    new.claim_id := 'vga-' || lpad(new.claim_seq::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_claims_set_claim_id on public.claims;
create trigger trg_claims_set_claim_id
  before insert on public.claims
  for each row execute function public.set_claim_id();

-- ===== INVITE-ONLY ENFORCEMENT (Kite, 25.03.2026) =====

-- System config (invite_only_until threshold)
create table if not exists public.system_config (
  key   text primary key,
  value text not null
);

insert into public.system_config (key, value)
values ('invite_only_until', '1000')
on conflict (key) do nothing;

-- Add invite_code column to claims (for audit trail)
alter table public.claims
  add column if not exists invite_code text;

-- Helper: validate + consume one invite code use
create or replace function public.consume_invite_code(p_code text)
returns boolean
language plpgsql
as $$
declare
  v_ok boolean := false;
begin
  update public.invite_codes
  set used_count = used_count + 1
  where code = p_code
    and active = true
    and (expires_at is null or expires_at > now())
    and used_count < max_uses
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- Trigger: enforce invite-only for claim_seq <= invite_only_until
create or replace function public.enforce_invite_only_claims()
returns trigger
language plpgsql
as $$
declare
  v_limit    int;
  v_consumed boolean;
begin
  select value::int into v_limit
  from public.system_config
  where key = 'invite_only_until';

  if v_limit is null then
    v_limit := 1000;
  end if;

  if new.claim_seq <= v_limit then
    if new.invite_code is null then
      raise exception 'Invite code required for early genesis claims (<= %)', v_limit;
    end if;

    v_consumed := public.consume_invite_code(new.invite_code);
    if not v_consumed then
      raise exception 'Invalid or exhausted invite code';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_claims_invite_only on public.claims;
create trigger trg_claims_invite_only
  before insert on public.claims
  for each row execute function public.enforce_invite_only_claims();

-- ===== Seed: first invite codes =====
insert into public.invite_codes (code, created_by, max_uses)
values
  ('VERUN-FOUNDING-001', 'rafael', 1),
  ('VERUN-FOUNDING-002', 'rafael', 1),
  ('VERUN-FOUNDING-003', 'rafael', 1),
  ('VERUN-BCP-001',      'bcp',    5),
  ('VERUN-SDF-001',      'sdf',   10)
on conflict (code) do nothing;
