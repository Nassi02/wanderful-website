-- LinkedIn (Community Management API) : connexion d'une page entreprise + publication automatique
-- Même modèle qu'Instagram : jetons illisibles côté navigateur, statut via fonctions.

create table if not exists public.li_connections (
  client_id uuid primary key references public.clients(id) on delete cascade,
  org_urn text,                       -- urn:li:organization:123 (page choisie)
  org_name text,
  org_choices jsonb,                  -- pages administrées par la personne connectée
  member_name text,
  access_token text not null,
  token_expires_at timestamptz,
  refresh_token text,
  refresh_expires_at timestamptz,
  status text not null default 'ok' check (status in ('ok','error')),
  last_error text,
  last_error_at timestamptz,
  publish_enabled boolean not null default false,
  enabled_at timestamptz,
  default_time text not null default '09:00' check (default_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.li_connections enable row level security;
revoke all on public.li_connections from anon, authenticated;

alter table public.content_items
  add column if not exists li_state text check (li_state in ('processing','published','error')),
  add column if not exists li_error text,
  add column if not exists li_post_urn text,
  add column if not exists li_permalink text,
  add column if not exists li_published_at timestamptz,
  add column if not exists li_work jsonb;

alter table public.data_sources drop constraint if exists data_sources_source_check;
alter table public.data_sources add constraint data_sources_source_check
  check (source in ('gsc','ga4','pagespeed','ads','gbp','meta','email','leads','linkedin','tiktok','facebook'));

create or replace function public.li_status(cid uuid)
returns table(connected boolean, org_urn text, org_name text, org_choices jsonb, member_name text,
              token_expires_at timestamptz, status text, last_error text, last_error_at timestamptz,
              publish_enabled boolean, enabled_at timestamptz, default_time text, connected_at timestamptz)
language sql security definer set search_path = public stable as $$
  select true, c.org_urn, c.org_name, c.org_choices, c.member_name, c.token_expires_at, c.status, c.last_error,
         c.last_error_at, c.publish_enabled, c.enabled_at, c.default_time, c.connected_at
  from li_connections c where c.client_id = cid and (is_agency() or my_client_id() = cid);
$$;
revoke all on function public.li_status(uuid) from public, anon;
grant execute on function public.li_status(uuid) to authenticated;

create or replace function public.li_settings(cid uuid, enabled boolean, dtime text, org text)
returns void language plpgsql security definer set search_path = public as $$
declare ch jsonb;
begin
  if not is_agency() then raise exception 'Réservé à l''agence'; end if;
  if org is not null then
    select org_choices into ch from li_connections where client_id = cid;
    if not exists (select 1 from jsonb_array_elements(coalesce(ch,'[]'::jsonb)) e where e->>'urn' = org) then
      raise exception 'Page non autorisée pour ce compte';
    end if;
  end if;
  update li_connections set
    org_urn = coalesce(org, org_urn),
    org_name = coalesce((select e->>'name' from jsonb_array_elements(coalesce(org_choices,'[]'::jsonb)) e where e->>'urn' = org limit 1), org_name),
    publish_enabled = case when org_urn is null and org is null then false else coalesce(enabled, publish_enabled) end,
    enabled_at = case when enabled is true and not publish_enabled then now() when enabled is false then null else enabled_at end,
    default_time = coalesce(dtime, default_time),
    updated_at = now()
  where client_id = cid;
end $$;
revoke all on function public.li_settings(uuid, boolean, text, text) from public, anon;
grant execute on function public.li_settings(uuid, boolean, text, text) to authenticated;

create or replace function public.li_disconnect(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_agency() then raise exception 'Réservé à l''agence'; end if;
  delete from li_connections where client_id = cid;
  update social_accounts set connected = false, auto = false where client_id = cid and platform = 'linkedin';
end $$;
revoke all on function public.li_disconnect(uuid) from public, anon;
grant execute on function public.li_disconnect(uuid) to authenticated;

select cron.unschedule('wf-li-publish') where exists (select 1 from cron.job where jobname = 'wf-li-publish');
select cron.schedule('wf-li-publish', '2-59/5 * * * *', $$
  select net.http_post(
    url := 'https://gafikuyoczmwdhztgckj.supabase.co/functions/v1/linkedin',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"cron":true}'::jsonb,
    timeout_milliseconds := 140000);
$$);
