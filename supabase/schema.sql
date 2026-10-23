-- ============================================================
-- HC Dashboard v2 — Schema
-- Cómo correrlo: Supabase → SQL Editor → New query → pega todo → Run
-- ============================================================

-- -------------------------------------------------------
-- 1. hcs — Hiring Consultants
-- -------------------------------------------------------
create table if not exists hcs (
  id            text primary key,        -- GHL user ID
  name          text not null,
  email         text,                    -- correo @remotelatinos.com
  calendar_email text,                   -- correo compartido en Google Calendar
  color         text,
  created_at    timestamptz default now()
);

insert into hcs (id, name, email, color) values
  ('Q0aVHyBbFhqJxWuEKLMt', 'Mateo Cortazar',        'mateo@remotelatinos.com',          '#6366f1'),
  ('uqAeFfwbHnH0lCwSvprz', 'Matt Chavez',            'matt@remotelatinos.com',            '#06b6d4'),
  ('YNlj27LBFv74CKLrh1zy', 'Maria Fernanda Franco',  'mariafernanda@remotelatinos.com',   '#10b981')
on conflict (id) do nothing;

-- -------------------------------------------------------
-- 2. clients — Un registro maestro por cliente real
-- -------------------------------------------------------
create table if not exists clients (
  id                  text primary key,   -- GHL contact ID
  name                text not null,
  hc_id               text references hcs(id),
  upsell_stage        text default 'N/A',
  upsell_stage_since  date,
  status              text default 'open'
                        check (status in ('open','closed','paused','pending')),
  active_days         int  default 0,
  pause_reason        text,
  return_date         date,
  job_team            text,
  rcrm_status         text,
  last_contact        timestamptz,
  last_contact_type   text,
  days_since_contact  int,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- -------------------------------------------------------
-- 3. client_links — Emparejamiento entre fuentes
-- Cada fila = un vínculo entre un cliente maestro y un registro en otra fuente
-- Ejemplos de source: 'rcrm', 'upsell_tracker', 'calendar', 'checkins'
-- -------------------------------------------------------
create table if not exists client_links (
  id          bigserial primary key,
  client_id   text not null references clients(id) on delete cascade,
  source      text not null,    -- 'rcrm' | 'upsell_tracker' | 'calendar' | 'checkins'
  source_id   text,             -- ID o fila en esa fuente (ej. email de invitado en calendar)
  method      text not null
                check (method in ('id','email','phone','name')),
  status      text not null default 'confirmed'
                check (status in ('confirmed','por_revisar','rechazado')),
  confidence  float,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists client_links_source_idx on client_links(source, source_id);
create index if not exists client_links_client_idx on client_links(client_id);

-- -------------------------------------------------------
-- 4. checkins
-- -------------------------------------------------------
create table if not exists checkins (
  id                    bigserial primary key,
  client_id             text references clients(id) on delete cascade,
  hc_id                 text references hcs(id),
  checkin_date          date not null,
  calendar_event_id     text,
  calendar_event_title  text,
  guest_email           text,
  fathom_recording_id   text,
  has_recording         boolean default false,
  status                text not null default 'por_confirmar'
                          check (status in ('realizado','no_realizado','por_confirmar')),
  origin                text not null default 'calendar'
                          check (origin in ('calendar','historial')),
  created_at            timestamptz default now()
);

-- -------------------------------------------------------
-- 5. messages — Actividad GHL (SMS y llamadas)
-- -------------------------------------------------------
create table if not exists messages (
  id                text primary key,   -- GHL message ID
  client_id         text references clients(id) on delete cascade,
  hc_id             text references hcs(id),
  message_type      text,               -- 'TYPE_SMS' | 'TYPE_CALL'
  direction         text,               -- 'outbound' | 'inbound'
  date_added        timestamptz,
  duration_seconds  int,
  is_conversation   boolean default false,  -- llamada >= 120 segundos
  source            text,               -- 'manual' | 'workflow' | 'campaign'
  created_at        timestamptz default now()
);

-- -------------------------------------------------------
-- 6. upsell_stages — Etapa actual de upsell por cliente
-- -------------------------------------------------------
create table if not exists upsell_stages (
  client_id             text primary key references clients(id) on delete cascade,
  stage                 text not null default 'N/A',
  stage_since           date,
  last_external_contact date,
  external_channel      text,
  client_responded      boolean default false,
  notes                 text,
  updated_at            timestamptz default now()
);

-- -------------------------------------------------------
-- 7. upsell_history — Cada cambio de etapa con fecha
-- -------------------------------------------------------
create table if not exists upsell_history (
  id          bigserial primary key,
  client_id   text references clients(id) on delete cascade,
  stage       text not null,
  changed_at  timestamptz default now(),
  changed_by  text   -- 'sync' o email del HC
);

-- -------------------------------------------------------
-- 8. junk_exclusions — Nombres que el sync ignora
-- -------------------------------------------------------
create table if not exists junk_exclusions (
  id            bigserial primary key,
  name_pattern  text not null unique,
  created_at    timestamptz default now()
);

insert into junk_exclusions (name_pattern) values
  ('Remote latinos Test'),
  ('Listing Admin'),
  ('Esteban')
on conflict (name_pattern) do nothing;

-- -------------------------------------------------------
-- 9. sync_runs — Log de cada sincronización
-- -------------------------------------------------------
create table if not exists sync_runs (
  id               bigserial primary key,
  started_at       timestamptz default now(),
  finished_at      timestamptz,
  status           text default 'running'
                     check (status in ('running','success','error')),
  total_clients    int,
  open_clients     int,
  clients_per_hc   jsonb,
  por_revisar      int,
  sin_asignar      int,
  errors           jsonb,
  notes            text
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Solo usuarios autenticados con correo @remotelatinos.com
-- pueden leer. El sincronizador escribe con service_role key
-- (que bypassea RLS automáticamente).
-- ============================================================

alter table hcs             enable row level security;
alter table clients         enable row level security;
alter table client_links    enable row level security;
alter table checkins        enable row level security;
alter table messages        enable row level security;
alter table upsell_stages   enable row level security;
alter table upsell_history  enable row level security;
alter table junk_exclusions enable row level security;
alter table sync_runs       enable row level security;

-- Lectura para @remotelatinos.com
create policy "rl_read" on hcs             for select to authenticated using ((auth.jwt() ->> 'email') like '%@remotelatinos.com');
create policy "rl_read" on clients         for select to authenticated using ((auth.jwt() ->> 'email') like '%@remotelatinos.com');
create policy "rl_read" on client_links    for select to authenticated using ((auth.jwt() ->> 'email') like '%@remotelatinos.com');
create policy "rl_read" on checkins        for select to authenticated using ((auth.jwt() ->> 'email') like '%@remotelatinos.com');
create policy "rl_read" on messages        for select to authenticated using ((auth.jwt() ->> 'email') like '%@remotelatinos.com');
create policy "rl_read" on upsell_stages   for select to authenticated using ((auth.jwt() ->> 'email') like '%@remotelatinos.com');
create policy "rl_read" on upsell_history  for select to authenticated using ((auth.jwt() ->> 'email') like '%@remotelatinos.com');
create policy "rl_read" on junk_exclusions for select to authenticated using ((auth.jwt() ->> 'email') like '%@remotelatinos.com');
create policy "rl_read" on sync_runs       for select to authenticated using ((auth.jwt() ->> 'email') like '%@remotelatinos.com');

-- client_links: @remotelatinos.com puede actualizar el status (confirmar / rechazar parejas)
create policy "rl_update_links" on client_links
  for update to authenticated
  using      ((auth.jwt() ->> 'email') like '%@remotelatinos.com')
  with check ((auth.jwt() ->> 'email') like '%@remotelatinos.com');
