-- Pilotage des données (Search Console / Analytics), bilans hebdomadaires et plan d'action.
-- Isolation : chaque ligne porte un client_id. Agence : accès complet. Client : lecture de ses propres lignes.
-- Les écritures de collecte sont faites par la fonction Edge (clé service, côté serveur uniquement).

create or replace function public.wf_is_agency() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'agency');
$$;
create or replace function public.wf_my_client() returns uuid
language sql stable security definer set search_path = public as $$
  select p.client_id from public.profiles p where p.id = auth.uid();
$$;

-- Sources connectées, par projet
create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source text not null check (source in ('gsc','ga4')),
  property text not null,          -- ex. sc-domain:wanderful-marketing.com ou properties/123
  domain text,
  active boolean not null default true,
  status text not null default 'pending' check (status in ('pending','ok','partial','error')),
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz default now(),
  unique (client_id, source, property)
);

-- Bilans hebdomadaires conservés (une ligne par projet, source et semaine analysée)
create table if not exists public.metric_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source text not null,
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('ok','partial')),
  data jsonb not null,
  created_at timestamptz default now(),
  unique (client_id, source, period_end)
);

-- Journal des exécutions (programmées ou manuelles), succès comme échecs
create table if not exists public.refresh_runs (
  id bigint generated always as identity primary key,
  client_id uuid references public.clients(id) on delete cascade,
  trigger text not null,
  status text not null,
  message text,
  started_at timestamptz default now(),
  finished_at timestamptz
);

-- Recommandations (dédupliquées par clé : une recommandation ouverte est mise à jour, pas recréée)
create table if not exists public.seo_recos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  key text not null,
  type text,
  page text,
  topic text,
  observation text,
  source text,
  interpretation text,
  uncertainty text,
  change text,
  current_text text,
  proposed_text text,
  priority text,
  effort text,
  evaluation text,
  status text not null default 'open' check (status in ('open','in_plan','done','dismissed')),
  first_seen date,
  last_seen date,
  updated_at timestamptz default now(),
  unique (client_id, key)
);

-- Plan d'action (recommandations ajoutées au suivi de projet)
create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  reco_key text,
  title text not null,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  page text,
  added_on date default current_date,
  source text,
  change text,
  done_on date,
  review text,
  created_at timestamptz default now(),
  unique (client_id, reco_key)
);

alter table public.data_sources  enable row level security;
alter table public.metric_reports enable row level security;
alter table public.refresh_runs  enable row level security;
alter table public.seo_recos     enable row level security;
alter table public.action_items  enable row level security;

do $$ declare t text; begin
  foreach t in array array['data_sources','metric_reports','refresh_runs','seo_recos','action_items'] loop
    execute format('drop policy if exists wf_agency_all on public.%I', t);
    execute format('create policy wf_agency_all on public.%I for all using (public.wf_is_agency()) with check (public.wf_is_agency())', t);
    execute format('drop policy if exists wf_client_read on public.%I', t);
    execute format('create policy wf_client_read on public.%I for select using (client_id = public.wf_my_client())', t);
  end loop;
end $$;

-- Source réellement existante pour Wanderful Marketing Sàrl (Search Console, propriété de domaine)
insert into public.data_sources (client_id, source, property, domain)
values ('04567b4c-87e5-47d7-b788-007d15497ecf', 'gsc', 'sc-domain:wanderful-marketing.com', 'wanderful-marketing.com')
on conflict (client_id, source, property) do nothing;

-- Programmation : chaque lundi 8 h, heure de Zurich.
-- pg_cron fonctionne en UTC : on déclenche à 6 h et 7 h UTC le lundi ; la fonction ne travaille
-- que s'il est bien 8 h à Zurich (heure d'été comme d'hiver) et ignore l'autre déclenchement.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'wf-weekly-refresh';
select cron.schedule('wf-weekly-refresh', '0 6,7 * * 1', $$
  select net.http_post(
    url := 'https://gafikuyoczmwdhztgckj.supabase.co/functions/v1/weekly-refresh',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_VGmuYmoeTAoR53GjOxQPpA_PGxmgoeG","Authorization":"Bearer sb_publishable_VGmuYmoeTAoR53GjOxQPpA_PGxmgoeG"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
