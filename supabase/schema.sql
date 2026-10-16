-- Ejecutar una vez en Supabase: SQL Editor > New query > pegar todo > Run.
-- Las tablas quedan con RLS activado y SIN políticas: nadie puede leerlas desde el navegador.
-- Solo el servidor (funciones /api con la clave service_role) accede a ellas.

create table if not exists public.usuarios (
  usuario      text primary key,
  nombre       text default '',
  cargo        text default '',
  area         text default '',
  motivo       text default '',
  hash         text not null,
  rol          text not null default 'visualizador' check (rol in ('administrador','visualizador')),
  estado       text not null default 'pendiente' check (estado in ('pendiente','activo','suspendido','rechazado')),
  permisos     jsonb not null default '{"nombres":true,"exportar":false}',
  comunas      jsonb not null default '[]',
  aprobado_por text,
  creado       timestamptz not null default now()
);

create table if not exists public.datos (
  id          int primary key default 1 check (id = 1),
  gz          text not null,          -- base completa, comprimida (gzip + base64)
  archivo     text,
  filas       int,
  desde       text,
  hasta       text,
  por         text,
  actualizado timestamptz not null default now()
);

create table if not exists public.cargas (
  id      bigserial primary key,
  fecha   timestamptz not null default now(),
  por     text,
  archivo text,
  modo    text,
  nuevas  int,
  filas   int
);

alter table public.usuarios enable row level security;
alter table public.datos    enable row level security;
alter table public.cargas   enable row level security;
