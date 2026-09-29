-- Thèmes supplémentaires : Site technique (PageSpeed). Recommandations rattachées à un thème.
alter table public.data_sources drop constraint if exists data_sources_source_check;
alter table public.data_sources add constraint data_sources_source_check check (source in ('gsc','ga4','pagespeed','ads','gbp','meta','email','leads'));
alter table public.seo_recos add column if not exists theme text not null default 'seo';
-- Thèmes volontairement non utilisés pour un client : ligne inactive (active = false, property = '—').
