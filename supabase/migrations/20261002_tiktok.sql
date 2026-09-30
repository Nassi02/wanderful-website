-- TikTok (Login Kit + Content Posting API) : connexion d'un compte TikTok + publication automatique des vidéos validées
-- Même modèle qu'Instagram / LinkedIn : jetons illisibles côté navigateur, statut via fonctions.

create table if not exists public.tt_connections (
  client_id uuid primary key references public.clients(id) on delete cascade,
  open_id text not null,
  username text,
  display_name text,
  avatar_url text,
  creator jsonb,                      -- dernier creator_info (visibilités possibles, options désactivées, durée max)
  access_token text not null,
  token_expires_at timestamptz,
  refresh_token text,
  refresh_expires_at timestamptz,
  audited boolean not null default false, -- tant que TikTok n'a pas validé l'app : publications privées uniquement
  status text not null default 'ok' check (status in ('ok','error')),
  last_error text,
  last_error_at timestamptz,
  publish_enabled boolean not null default false,
  enabled_at timestamptz,
  default_time text not null default '18:00' check (default_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tt_connections enable row level security;
revoke all on public.tt_connections from anon, authenticated;

alter table public.content_items
  add column if not exists tt_state text check (tt_state in ('processing','published','error')),
  add column if not exists tt_error text,
  add column if not exists tt_publish_id text,
  add column if not exists tt_post_id text,
  add column if not exists tt_permalink text,
  add column if not exists tt_published_at timestamptz;

create or replace function public.tt_status(cid uuid)
returns table(connected boolean, username text, display_name text, avatar_url text, creator jsonb, audited boolean,
              token_expires_at timestamptz, refresh_expires_at timestamptz, status text, last_error text, last_error_at timestamptz,
              publish_enabled boolean, enabled_at timestamptz, default_time text, connected_at timestamptz)
language sql security definer set search_path = public stable as $$
  select true, c.username, c.display_name, c.avatar_url, c.creator, c.audited, c.token_expires_at, c.refresh_expires_at,
         c.status, c.last_error, c.last_error_at, c.publish_enabled, c.enabled_at, c.default_time, c.connected_at
  from tt_connections c where c.client_id = cid and (is_agency() or my_client_id() = cid);
$$;
revoke all on function public.tt_status(uuid) from public, anon;
grant execute on function public.tt_status(uuid) to authenticated;

create or replace function public.tt_settings(cid uuid, enabled boolean, dtime text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_agency() then raise exception 'Réservé à l''agence'; end if;
  update tt_connections set
    publish_enabled = coalesce(enabled, publish_enabled),
    enabled_at = case when enabled is true and not publish_enabled then now() when enabled is false then null else enabled_at end,
    default_time = coalesce(dtime, default_time),
    updated_at = now()
  where client_id = cid;
end $$;
revoke all on function public.tt_settings(uuid, boolean, text) from public, anon;
grant execute on function public.tt_settings(uuid, boolean, text) to authenticated;

create or replace function public.tt_disconnect(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_agency() then raise exception 'Réservé à l''agence'; end if;
  delete from tt_connections where client_id = cid;
  update social_accounts set connected = false, auto = false where client_id = cid and platform = 'tiktok';
end $$;
revoke all on function public.tt_disconnect(uuid) from public, anon;
grant execute on function public.tt_disconnect(uuid) to authenticated;

select cron.unschedule('wf-tt-publish') where exists (select 1 from cron.job where jobname = 'wf-tt-publish');
select cron.schedule('wf-tt-publish', '4-59/5 * * * *', $$
  select net.http_post(
    url := 'https://gafikuyoczmwdhztgckj.supabase.co/functions/v1/tiktok',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"cron":true}'::jsonb,
    timeout_milliseconds := 140000);
$$);
