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

-- Mapa de poder e interés: ajustes manuales por pescador (RPA). Sin fila = cálculo automático.
create table if not exists public.evaluaciones (
  rpa         text primary key,
  poder       smallint check (poder between 1 and 5),
  interes     smallint check (interes between 1 and 5),
  nota        text default '',
  organizacion text default '',
  por         text,
  actualizado timestamptz not null default now()
);

-- Actualización: si la tabla evaluaciones ya existía, se agregan la organización y los niveles opcionales.
alter table public.evaluaciones add column if not exists organizacion text default '';
alter table public.evaluaciones alter column poder drop not null;
alter table public.evaluaciones alter column interes drop not null;

-- Ajustes generales: precios de playa por especie, vedas y umbral de alertas.
create table if not exists public.ajustes (
  id          int primary key default 1 check (id = 1),
  data        jsonb not null default '{}',
  por         text,
  actualizado timestamptz not null default now()
);

-- Bitácora de relacionamiento por pescador u organización.
create table if not exists public.bitacora (
  id          bigserial primary key,
  clave       text not null,
  actor       text,
  fecha       date not null default current_date,
  tipo        text not null default 'Reunión',
  estado      text not null default 'Pendiente',
  responsable text default '',
  texto       text not null,
  por         text,
  creado      timestamptz not null default now()
);

-- Vistas guardadas de cada usuario.
create table if not exists public.vistas (
  usuario     text primary key,
  data        jsonb not null default '[]',
  actualizado timestamptz not null default now()
);

-- Registro de actividad.
create table if not exists public.actividad (
  id      bigserial primary key,
  fecha   timestamptz not null default now(),
  usuario text,
  accion  text,
  detalle text
);

-- Exigencias ambientales: base de RCA (fichas por numeral), categorización y visibilidad.
create table if not exists public.rca_base (
  id          int primary key default 1 check (id = 1),
  gz          text not null,          -- fichas de todas las RCA, comprimidas (gzip + base64)
  archivo     text,
  rcas        int,
  fichas      int,
  generado    text,
  por         text,
  actualizado timestamptz not null default now()
);

create table if not exists public.rca_estado (
  id          text primary key,       -- ficha (RCA-número de ficha)
  categoria   smallint,               -- 0 CAV, 1 Medida, 2 Seguimiento, 3 Exigencia, 4 Otro, -2 Descartado
  habilitado  boolean not null default false,
  nota        text default '',
  por         text,
  actualizado timestamptz not null default now()
);

create table if not exists public.rca_visibilidad (
  rca         text primary key,
  visible     boolean not null default true,
  por         text,
  actualizado timestamptz not null default now()
);

-- Seguimiento de cumplimiento: avance por verificador de cada compromiso y su historial.
create table if not exists public.rca_seguimiento (
  gid         text primary key,       -- primera ficha del compromiso
  fichas      jsonb not null default '[]'::jsonb,
  items       jsonb not null default '[]'::jsonb,   -- [{t: verificador, p: %, o: observación, f: fecha, u: usuario}]
  por         text,
  actualizado timestamptz not null default now()
);

create table if not exists public.rca_seguimiento_hist (
  id          bigserial primary key,
  gid         text not null,
  item        int,
  verificador text,
  pct         smallint,
  obs         text default '',
  usuario     text,
  fecha       timestamptz not null default now()
);
create index if not exists rca_seguimiento_hist_gid on public.rca_seguimiento_hist (gid);

alter table public.usuarios enable row level security;
alter table public.datos    enable row level security;
alter table public.cargas   enable row level security;
alter table public.evaluaciones enable row level security;
alter table public.ajustes      enable row level security;
alter table public.bitacora     enable row level security;
alter table public.vistas       enable row level security;
alter table public.actividad    enable row level security;
alter table public.rca_base        enable row level security;
alter table public.rca_estado      enable row level security;
alter table public.rca_visibilidad enable row level security;
alter table public.rca_seguimiento      enable row level security;
alter table public.rca_seguimiento_hist enable row level security;
