-- Facebook (API Pages) : connexion d'une page Facebook + publication automatique
-- Même modèle qu'Instagram / LinkedIn / TikTok : jetons illisibles côté navigateur, statut via fonctions.
-- « Reprendre Instagram » (mirror_ig) : un contenu Instagram part aussi sur Facebook, sauf si on décoche Facebook (brief.fb_off).

create table if not exists public.fb_connections (
  client_id uuid primary key references public.clients(id) on delete cascade,
  page_id text,                        -- page choisie
  page_name text,
  page_picture text,
  page_choices jsonb,                  -- pages administrées : [{id,name,picture}] (sans jeton)
  page_tokens jsonb,                   -- {page_id: jeton de page} — jamais exposé
  user_name text,
  user_token text not null,
  token_expires_at timestamptz,
  followers integer,
  status text not null default 'ok' check (status in ('ok','error')),
  last_error text,
  last_error_at timestamptz,
  publish_enabled boolean not null default false,
  enabled_at timestamptz,
  mirror_ig boolean not null default true,
  default_time text not null default '18:00' check (default_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.fb_connections enable row level security;
revoke all on public.fb_connections from anon, authenticated;

alter table public.content_items
  add column if not exists fb_state text check (fb_state in ('processing','published','error')),
  add column if not exists fb_error text,
  add column if not exists fb_post_id text,
  add column if not exists fb_permalink text,
  add column if not exists fb_published_at timestamptz,
  add column if not exists fb_work jsonb;

create or replace function public.fb_status(cid uuid)
returns table(connected boolean, page_id text, page_name text, page_picture text, page_choices jsonb, user_name text,
              token_expires_at timestamptz, followers integer, status text, last_error text, last_error_at timestamptz,
              publish_enabled boolean, enabled_at timestamptz, mirror_ig boolean, default_time text, connected_at timestamptz)
language sql security definer set search_path = public stable as $$
  select true, c.page_id, c.page_name, c.page_picture, c.page_choices, c.user_name, c.token_expires_at, c.followers,
         c.status, c.last_error, c.last_error_at, c.publish_enabled, c.enabled_at, c.mirror_ig, c.default_time, c.connected_at
  from fb_connections c where c.client_id = cid and (is_agency() or my_client_id() = cid);
$$;
revoke all on function public.fb_status(uuid) from public, anon;
grant execute on function public.fb_status(uuid) to authenticated;

create or replace function public.fb_settings(cid uuid, enabled boolean, dtime text, page text, mirror boolean)
returns void language plpgsql security definer set search_path = public as $$
declare ch jsonb;
begin
  if not is_agency() then raise exception 'Réservé à l''agence'; end if;
  if page is not null then
    select page_choices into ch from fb_connections where client_id = cid;
    if not exists (select 1 from jsonb_array_elements(coalesce(ch,'[]'::jsonb)) e where e->>'id' = page) then
      raise exception 'Page non autorisée pour ce compte';
    end if;
    if exists (select 1 from fb_connections o where o.page_id = page and o.client_id <> cid) then
      raise exception 'Cette page Facebook est déjà reliée à un autre projet';
    end if;
  end if;
  update fb_connections set
    page_id = coalesce(page, page_id),
    page_name = coalesce((select e->>'name' from jsonb_array_elements(coalesce(page_choices,'[]'::jsonb)) e where e->>'id' = page limit 1), page_name),
    page_picture = coalesce((select e->>'picture' from jsonb_array_elements(coalesce(page_choices,'[]'::jsonb)) e where e->>'id' = page limit 1), page_picture),
    publish_enabled = case when page_id is null and page is null then false else coalesce(enabled, publish_enabled) end,
    enabled_at = case when enabled is true and not publish_enabled then now() when enabled is false then null else enabled_at end,
    mirror_ig = coalesce(mirror, mirror_ig),
    default_time = coalesce(dtime, default_time),
    updated_at = now()
  where client_id = cid;
end $$;
revoke all on function public.fb_settings(uuid, boolean, text, text, boolean) from public, anon;
grant execute on function public.fb_settings(uuid, boolean, text, text, boolean) to authenticated;

create or replace function public.fb_disconnect(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_agency() then raise exception 'Réservé à l''agence'; end if;
  delete from fb_connections where client_id = cid;
  update social_accounts set connected = false, auto = false where client_id = cid and platform = 'facebook';
end $$;
revoke all on function public.fb_disconnect(uuid) from public, anon;
grant execute on function public.fb_disconnect(uuid) to authenticated;

select cron.unschedule('wf-fb-publish') where exists (select 1 from cron.job where jobname = 'wf-fb-publish');
select cron.schedule('wf-fb-publish', '3-59/5 * * * *', $$
  select net.http_post(
    url := 'https://gafikuyoczmwdhztgckj.supabase.co/functions/v1/facebook',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"cron":true}'::jsonb,
    timeout_milliseconds := 140000);
$$);
