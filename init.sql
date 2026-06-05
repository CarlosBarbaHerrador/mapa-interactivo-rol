create table regions (
  name text primary key,
  path text not null,
  transform text,
  color text default '#e94560',
  description text default '',
  extraPaths jsonb default '[]'
);

create table pois (
  id serial primary key,
  name text not null,
  category text not null,
  coords jsonb not null,
  description text default '',
  links jsonb default '[]'
);

create table paint (
  id serial primary key,
  tool text not null,
  color text,
  region text,
  points jsonb,
  image_base64 text
);

create table cursors (
  id text primary key,
  x float not null,
  y float not null,
  user_name text not null,
  color text default '#e94560',
  updated_at timestamptz default now()
);

alter table regions enable row level security;
create policy "Acceso público todo" on regions for all using (true) with check (true);

alter table pois enable row level security;
create policy "Acceso público todo" on pois for all using (true) with check (true);

alter table paint enable row level security;
create policy "Acceso público todo" on paint for all using (true) with check (true);

alter table cursors enable row level security;
create policy "Acceso público todo" on cursors for all using (true) with check (true);
