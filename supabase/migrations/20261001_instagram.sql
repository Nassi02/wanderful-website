-- Instagram : connexion (API Instagram avec connexion Instagram) + publication automatique
-- Les jetons ne sont lisibles par personne côté navigateur : RLS activée sans aucune politique
-- (seules les fonctions Edge, avec la clé service, y accèdent). Le statut non secret passe par ig_status().

create table if not exists public.ig_connections (
  client_id uuid primary key references public.clients(id) on delete cascade,
  ig_user_id text not null,
  username text,
  account_type text,
  profile_picture_url text,
  followers integer,
  access_token text not null,
  token_expires_at timestamptz,
  status text not null default 'ok' check (status in ('ok','error')),
  last_error text,
  last_error_at timestamptz,
  publish_enabled boolean not null default false,
  enabled_at timestamptz,
  default_time text not null default '18:00' check (default_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ig_connections enable row level security;
revoke all on public.ig_connections from anon, authenticated;

-- Suivi de publication sur chaque contenu
alter table public.content_items
  add column if not exists publish_state text check (publish_state in ('processing','published','error')),
  add column if not exists publish_error text,
  add column if not exists ig_container_id text,
  add column if not exists ig_media_id text,
  add column if not exists permalink text,
  add column if not exists published_at timestamptz;

-- Statut lisible (sans jeton) : agence, ou client pour son propre projet
create or replace function public.ig_status(cid uuid)
returns table(connected boolean, username text, account_type text, profile_picture_url text, followers integer,
              token_expires_at timestamptz, status text, last_error text, last_error_at timestamptz,
              publish_enabled boolean, enabled_at timestamptz, default_time text, connected_at timestamptz)
language sql security definer set search_path = public stable as $$
  select true, c.username, c.account_type, c.profile_picture_url, c.followers, c.token_expires_at, c.status,
         c.last_error, c.last_error_at, c.publish_enabled, c.enabled_at, c.default_time, c.connected_at
  from ig_connections c
  where c.client_id = cid and (is_agency() or my_client_id() = cid);
$$;
revoke all on function public.ig_status(uuid) from public, anon;
grant execute on function public.ig_status(uuid) to authenticated;

-- Réglages (agence uniquement) : activer/désactiver la publication auto, heure par défaut
create or replace function public.ig_settings(cid uuid, enabled boolean, dtime text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_agency() then raise exception 'Réservé à l''agence'; end if;
  update ig_connections set
    publish_enabled = coalesce(enabled, publish_enabled),
    enabled_at = case when enabled is true and not publish_enabled then now()
                      when enabled is false then null else enabled_at end,
    default_time = coalesce(dtime, default_time),
    updated_at = now()
  where client_id = cid;
end $$;
revoke all on function public.ig_settings(uuid, boolean, text) from public, anon;
grant execute on function public.ig_settings(uuid, boolean, text) to authenticated;

-- Déconnexion (agence uniquement)
create or replace function public.ig_disconnect(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_agency() then raise exception 'Réservé à l''agence'; end if;
  delete from ig_connections where client_id = cid;
  update social_accounts set connected = false, auto = false where client_id = cid and platform = 'instagram';
end $$;
revoke all on function public.ig_disconnect(uuid) from public, anon;
grant execute on function public.ig_disconnect(uuid) to authenticated;

-- Publication : toutes les 5 minutes (la fonction ne publie que les contenus validés, à l'heure prévue,
-- pour les comptes dont la publication automatique est activée)
select cron.unschedule('wf-ig-publish') where exists (select 1 from cron.job where jobname = 'wf-ig-publish');
select cron.schedule('wf-ig-publish', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://gafikuyoczmwdhztgckj.supabase.co/functions/v1/instagram',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"cron":true}'::jsonb,
    timeout_milliseconds := 140000);
$$);
