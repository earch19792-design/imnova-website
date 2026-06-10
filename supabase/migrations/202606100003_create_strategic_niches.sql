create extension if not exists pgcrypto;

create table if not exists public.strategic_niches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  icon text,
  sort_order integer default 0,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.strategic_subniches (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references public.strategic_niches(id) on delete cascade,
  name text not null,
  slug text not null unique,
  description text,
  icon text,
  sort_order integer default 0,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.product_subniches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  subniche_id uuid not null references public.strategic_subniches(id) on delete cascade,
  is_primary boolean default false,
  created_at timestamp with time zone default now(),
  unique(product_id, subniche_id)
);

create unique index if not exists product_subniches_one_primary_idx
  on public.product_subniches(product_id)
  where is_primary = true;

create index if not exists strategic_subniches_niche_id_idx
  on public.strategic_subniches(niche_id);

create index if not exists product_subniches_product_id_idx
  on public.product_subniches(product_id);

create index if not exists product_subniches_subniche_id_idx
  on public.product_subniches(subniche_id);

alter table public.products
add column if not exists commercial_category text,
add column if not exists strategic_niche_id uuid references public.strategic_niches(id),
add column if not exists primary_subniche_id uuid references public.strategic_subniches(id),
add column if not exists target_customer text,
add column if not exists usage_moment text,
add column if not exists main_benefit text;

comment on table public.strategic_niches is
  'Internal IMNOVA OS strategic niches for product analysis, validation, campaigns and metrics. These do not replace public store categories.';

comment on table public.strategic_subniches is
  'Internal IMNOVA OS subniches associated with strategic niches.';

comment on table public.product_subniches is
  'Many-to-many internal classification between products and strategic subniches. One primary subniche per product is enforced with a partial unique index.';

comment on column public.products.commercial_category is
  'Simple commercial category for marketplace and IMNOVA OS filtering.';

comment on column public.products.strategic_niche_id is
  'Internal primary strategic niche for IMNOVA OS.';

comment on column public.products.primary_subniche_id is
  'Internal primary subniche for IMNOVA OS.';

comment on column public.products.target_customer is
  'Internal audience definition for analysis and campaigns.';

comment on column public.products.usage_moment is
  'Internal product usage moment for strategy, campaigns and content.';

comment on column public.products.main_benefit is
  'Internal main benefit promise for strategy and messaging.';

insert into public.strategic_niches (
  name,
  slug,
  description,
  icon,
  sort_order,
  is_active
)
values
(
  'Bienestar y Salud Natural',
  'bienestar-salud-natural',
  'Productos orientados a bienestar diario, vida saludable, nutrición natural, hábitos equilibrados y soluciones naturales para mejorar la calidad de vida.',
  'leaf',
  1,
  true
),
(
  'Fitness, Rendimiento y Recuperación',
  'fitness-rendimiento-recuperacion',
  'Productos enfocados en personas activas, gimnasio, deporte, energía, recuperación, hidratación, nutrición fitness y control de peso.',
  'trophy',
  2,
  true
),
(
  'Salud y Funcionalidad Específica',
  'salud-funcionalidad-especifica',
  'Productos con beneficios funcionales específicos como concentración, digestión, descanso, sistema inmune, articulaciones, estrés, detox y bienestar especializado.',
  'brain',
  3,
  true
),
(
  'Cuidado Personal y Belleza Natural',
  'cuidado-personal-belleza-natural',
  'Productos orientados a piel, cabello, uñas, belleza limpia, cuidado personal, envejecimiento saludable, bienestar emocional y longevidad.',
  'sparkles',
  4,
  true
),
(
  'Bienestar Animal y Cuidado de Mascotas',
  'bienestar-animal-cuidado-mascotas',
  'Productos orientados al bienestar de mascotas, caballos, aves, peces, reptiles, animales exóticos y animales de granja.',
  'paw-print',
  5,
  true
)
on conflict (slug)
do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.strategic_subniches (
  niche_id,
  name,
  slug,
  description,
  icon,
  sort_order,
  is_active
)
select
  strategic_niches.id,
  subniches.name,
  subniches.slug,
  subniches.description,
  subniches.icon,
  subniches.sort_order,
  true
from (
  values
    ('bienestar-salud-natural', 'Suplementos Nutricionales', 'suplementos-nutricionales', 'Productos de apoyo nutricional para rutinas de bienestar diario.', 'pill', 10),
    ('bienestar-salud-natural', 'Vida Saludable', 'vida-saludable', 'Soluciones para hábitos equilibrados, energía diaria y bienestar moderno.', 'salad', 20),
    ('bienestar-salud-natural', 'Productos Orgánicos', 'productos-organicos', 'Productos inspirados en ingredientes naturales, orgánicos y de origen limpio.', 'wheat', 30),
    ('bienestar-salud-natural', 'Belleza y Antiedad', 'belleza-antiedad', 'Bienestar conectado con apariencia saludable, vitalidad y cuidado preventivo.', 'sparkles', 40),
    ('bienestar-salud-natural', 'Remedios Naturales', 'remedios-naturales', 'Alternativas naturales para necesidades cotidianas de bienestar.', 'leaf', 50),
    ('bienestar-salud-natural', 'Salud Holística', 'salud-holistica', 'Bienestar integral que conecta cuerpo, mente y hábitos sostenibles.', 'meditation', 60),
    ('bienestar-salud-natural', 'Vegano y Plant-Based', 'vegano-plant-based', 'Productos orientados a estilos de vida veganos, vegetales y conscientes.', 'sprout', 70),

    ('fitness-rendimiento-recuperacion', 'Nutrición Fitness', 'nutricion-fitness', 'Alimentos, bebidas y suplementos para personas activas y rutinas de entrenamiento.', 'apple', 10),
    ('fitness-rendimiento-recuperacion', 'Rendimiento Atlético', 'rendimiento-atletico', 'Soluciones enfocadas en energía, desempeño y constancia física.', 'zap', 20),
    ('fitness-rendimiento-recuperacion', 'Recuperación Deportiva', 'recuperacion-deportiva', 'Productos diseñados para apoyar recuperación y continuidad de entrenamiento.', 'activity', 30),
    ('fitness-rendimiento-recuperacion', 'Control de Peso', 'control-peso', 'Alternativas funcionales para control de peso, saciedad y hábitos alimenticios.', 'scale', 40),
    ('fitness-rendimiento-recuperacion', 'Hidratación', 'hidratacion', 'Productos orientados a hidratación, electrolitos y rendimiento diario.', 'droplets', 50),
    ('fitness-rendimiento-recuperacion', 'Resistencia y Alto Rendimiento', 'resistencia-alto-rendimiento', 'Soluciones para demandas físicas intensas y rutinas de alto desempeño.', 'trophy', 60),

    ('salud-funcionalidad-especifica', 'Apoyo Inmunológico', 'apoyo-inmunologico', 'Productos orientados a defensas, sistema inmune y bienestar preventivo.', 'shield', 10),
    ('salud-funcionalidad-especifica', 'Salud Digestiva', 'salud-digestiva', 'Soluciones para digestión, microbiota, fibra y equilibrio intestinal.', 'stomach', 20),
    ('salud-funcionalidad-especifica', 'Superalimentos', 'superalimentos', 'Ingredientes densos en nutrientes con beneficios funcionales específicos.', 'star', 30),
    ('salud-funcionalidad-especifica', 'Apoyo Antiinflamatorio', 'apoyo-antiinflamatorio', 'Productos con enfoque en bienestar, inflamación y recuperación funcional.', 'butterfly', 40),
    ('salud-funcionalidad-especifica', 'Detox y Limpieza', 'detox-limpieza', 'Soluciones para rutinas de limpieza, balance y reinicio de hábitos.', 'droplet', 50),
    ('salud-funcionalidad-especifica', 'Aceites Esenciales', 'aceites-esenciales', 'Productos aromáticos y funcionales para bienestar emocional y físico.', 'flower', 60),
    ('salud-funcionalidad-especifica', 'Suplementos Herbales', 'suplementos-herbales', 'Extractos herbales y soluciones naturales con beneficios funcionales.', 'sprout', 70),
    ('salud-funcionalidad-especifica', 'Apoyo Cognitivo', 'apoyo-cognitivo', 'Productos orientados a enfoque, claridad mental y concentración.', 'brain', 80),
    ('salud-funcionalidad-especifica', 'Estado de Ánimo y Estrés', 'estado-animo-estres', 'Soluciones para bienestar emocional, calma y manejo de estrés cotidiano.', 'smile', 90),
    ('salud-funcionalidad-especifica', 'Apoyo al Sueño', 'apoyo-sueno', 'Productos para descanso, recuperación nocturna y rutinas de sueño.', 'moon', 100),
    ('salud-funcionalidad-especifica', 'Salud Articular', 'salud-articular', 'Soluciones para articulaciones, movilidad y soporte funcional.', 'bone', 110),
    ('salud-funcionalidad-especifica', 'Apoyo Autoinmune e Inflamación', 'apoyo-autoinmune-inflamacion', 'Productos orientados a necesidades especializadas de inflamación y bienestar inmune.', 'microscope', 120),

    ('cuidado-personal-belleza-natural', 'Cuidado de la Piel Plant-Based', 'cuidado-piel-plant-based', 'Cuidado de piel con enfoque natural, vegetal y limpio.', 'flower', 10),
    ('cuidado-personal-belleza-natural', 'Belleza Natural', 'belleza-natural', 'Productos para belleza cotidiana con ingredientes y promesas limpias.', 'sparkles', 20),
    ('cuidado-personal-belleza-natural', 'Cuidado del Cabello', 'cuidado-cabello', 'Soluciones para cabello, cuero cabelludo y cuidado personal.', 'leaf', 30),
    ('cuidado-personal-belleza-natural', 'Vitaminas y Minerales', 'vitaminas-minerales', 'Nutrientes esenciales conectados con belleza, bienestar y rendimiento.', 'pill', 40),
    ('cuidado-personal-belleza-natural', 'Belleza Limpia', 'belleza-limpia', 'Cuidado personal sin fórmulas innecesariamente agresivas o cargadas.', 'sprout', 50),
    ('cuidado-personal-belleza-natural', 'Envejecimiento Saludable', 'envejecimiento-saludable', 'Soluciones para vitalidad, bienestar y edad saludable.', 'heart', 60),
    ('cuidado-personal-belleza-natural', 'Mindfulness y Meditación', 'mindfulness-meditacion', 'Productos y experiencias para calma, intención y bienestar mental.', 'meditation', 70),
    ('cuidado-personal-belleza-natural', 'Detox de la Piel', 'detox-piel', 'Rutinas de limpieza, renovación y cuidado de piel.', 'leaf', 80),
    ('cuidado-personal-belleza-natural', 'Longevidad y Antiedad', 'longevidad-antiedad', 'Productos para vitalidad, longevidad, prevención y bienestar avanzado.', 'hourglass', 90),

    ('bienestar-animal-cuidado-mascotas', 'Bienestar de Mascotas', 'bienestar-mascotas', 'Productos para perros, gatos y mascotas del hogar.', 'paw-print', 10),
    ('bienestar-animal-cuidado-mascotas', 'Salud y Rendimiento Equino', 'salud-rendimiento-equino', 'Soluciones para bienestar, energía y cuidado de caballos.', 'horse', 20),
    ('bienestar-animal-cuidado-mascotas', 'Bienestar Ganadero', 'bienestar-ganadero', 'Productos para cuidado y bienestar de animales de granja.', 'cow', 30),
    ('bienestar-animal-cuidado-mascotas', 'Salud Avícola', 'salud-avicola', 'Soluciones para aves de producción, cuidado y bienestar.', 'bird', 40),
    ('bienestar-animal-cuidado-mascotas', 'Cuidado de Reptiles y Mascotas Exóticas', 'cuidado-reptiles-mascotas-exoticas', 'Productos para reptiles y animales exóticos.', 'lizard', 50),
    ('bienestar-animal-cuidado-mascotas', 'Salud de Peces y Vida Acuática', 'salud-peces-vida-acuatica', 'Soluciones para peces y ecosistemas acuáticos.', 'fish', 60),
    ('bienestar-animal-cuidado-mascotas', 'Bienestar de Aves', 'bienestar-aves', 'Productos para aves de compañía y bienestar aviar.', 'bird', 70)
) as subniches(niche_slug, name, slug, description, icon, sort_order)
join public.strategic_niches
  on strategic_niches.slug = subniches.niche_slug
on conflict (slug)
do update set
  niche_id = excluded.niche_id,
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

update public.products
set
  commercial_category = 'Café funcional',
  strategic_niche_id = (
    select id
    from public.strategic_niches
    where slug = 'bienestar-salud-natural'
  ),
  primary_subniche_id = (
    select id
    from public.strategic_subniches
    where slug = 'vida-saludable'
  ),
  target_customer = 'Personas de oficina, estudiantes y personas que buscan energía limpia y bienestar diario.',
  usage_moment = 'Mañana, oficina o estudio.',
  main_benefit = 'Energía limpia, enfoque diario y bienestar.'
where slug in (
  'mash-coffee',
  'mash-coffee-6pack',
  'mash-coffee-12pack'
);

update public.products
set
  commercial_category = 'Alimentos funcionales',
  strategic_niche_id = (
    select id
    from public.strategic_niches
    where slug = 'fitness-rendimiento-recuperacion'
  ),
  primary_subniche_id = (
    select id
    from public.strategic_subniches
    where slug = 'nutricion-fitness'
  ),
  target_customer = 'Personas activas, gym, estudiantes, oficina y familias que buscan desayunos más nutritivos.',
  usage_moment = 'Desayuno, después del gym o snack saludable.',
  main_benefit = 'Pancakes ricos, fáciles y con proteína.'
where slug = 'mash-nutri-pancake';

update public.products
set
  commercial_category = 'Alimentos funcionales',
  strategic_niche_id = (
    select id
    from public.strategic_niches
    where slug = 'fitness-rendimiento-recuperacion'
  ),
  primary_subniche_id = (
    select id
    from public.strategic_subniches
    where slug = 'nutricion-fitness'
  ),
  target_customer = 'Personas activas, oficina, estudiantes y familias que buscan una opción de pan más nutritiva.',
  usage_moment = 'Desayuno, comida o snack saludable.',
  main_benefit = 'Pan rico, fácil y con proteína para acompañar la rutina diaria.'
where slug = 'mash-nutri-pan';

update public.product_subniches
set is_primary = false
where product_id in (
  select id
  from public.products
  where slug in (
    'mash-coffee',
    'mash-coffee-6pack',
    'mash-coffee-12pack',
    'mash-nutri-pancake',
    'mash-nutri-pan'
  )
);

insert into public.product_subniches (
  product_id,
  subniche_id,
  is_primary
)
select
  products.id,
  strategic_subniches.id,
  product_links.is_primary
from (
  values
    ('mash-coffee', 'vida-saludable', true),
    ('mash-coffee', 'apoyo-cognitivo', false),
    ('mash-coffee', 'suplementos-herbales', false),
    ('mash-coffee', 'vitaminas-minerales', false),
    ('mash-coffee', 'longevidad-antiedad', false),
    ('mash-coffee', 'estado-animo-estres', false),
    ('mash-coffee-6pack', 'vida-saludable', true),
    ('mash-coffee-6pack', 'apoyo-cognitivo', false),
    ('mash-coffee-6pack', 'suplementos-herbales', false),
    ('mash-coffee-6pack', 'vitaminas-minerales', false),
    ('mash-coffee-6pack', 'longevidad-antiedad', false),
    ('mash-coffee-6pack', 'estado-animo-estres', false),
    ('mash-coffee-12pack', 'vida-saludable', true),
    ('mash-coffee-12pack', 'apoyo-cognitivo', false),
    ('mash-coffee-12pack', 'suplementos-herbales', false),
    ('mash-coffee-12pack', 'vitaminas-minerales', false),
    ('mash-coffee-12pack', 'longevidad-antiedad', false),
    ('mash-coffee-12pack', 'estado-animo-estres', false),
    ('mash-nutri-pancake', 'nutricion-fitness', true),
    ('mash-nutri-pancake', 'control-peso', false),
    ('mash-nutri-pancake', 'rendimiento-atletico', false),
    ('mash-nutri-pancake', 'vida-saludable', false),
    ('mash-nutri-pan', 'nutricion-fitness', true),
    ('mash-nutri-pan', 'control-peso', false),
    ('mash-nutri-pan', 'vida-saludable', false)
) as product_links(product_slug, subniche_slug, is_primary)
join public.products
  on products.slug = product_links.product_slug
join public.strategic_subniches
  on strategic_subniches.slug = product_links.subniche_slug
on conflict (product_id, subniche_id)
do update set
  is_primary = excluded.is_primary;

alter table public.strategic_niches
enable row level security;

alter table public.strategic_subniches
enable row level security;

alter table public.product_subniches
enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'strategic_niches'
      and policyname = 'Authenticated can read strategic niches'
  ) then
    create policy "Authenticated can read strategic niches"
      on public.strategic_niches
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'strategic_subniches'
      and policyname = 'Authenticated can read strategic subniches'
  ) then
    create policy "Authenticated can read strategic subniches"
      on public.strategic_subniches
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'product_subniches'
      and policyname = 'Authenticated can read product subniches'
  ) then
    create policy "Authenticated can read product subniches"
      on public.product_subniches
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'strategic_niches'
      and policyname = 'Authenticated can manage strategic niches'
  ) then
    create policy "Authenticated can manage strategic niches"
      on public.strategic_niches
      for all
      to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'strategic_subniches'
      and policyname = 'Authenticated can manage strategic subniches'
  ) then
    create policy "Authenticated can manage strategic subniches"
      on public.strategic_subniches
      for all
      to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'product_subniches'
      and policyname = 'Authenticated can manage product subniches'
  ) then
    create policy "Authenticated can manage product subniches"
      on public.product_subniches
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;
