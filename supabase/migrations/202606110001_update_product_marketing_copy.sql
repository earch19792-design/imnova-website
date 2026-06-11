begin;

update public.products
set
  category = 'Café funcional',
  commercial_category = 'Café funcional con colágeno marino',
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
  target_customer = 'Personas de oficina, estudiantes y consumidores que quieren café práctico, cero azúcar, colágeno marino, vitaminas y bienestar funcional en su rutina diaria.',
  nicho = 'Bienestar y Salud Natural; Cuidado Personal y Belleza Natural; Productividad diaria',
  problema_resuelve = 'Personas que quieren tomar café y a la vez integrar colágeno marino, vitaminas y bienestar funcional sin agregar más pasos a su rutina.',
  expected_benefit = 'Café latte funcional con 10g de colágeno marino, vitaminas B6, B12 y D3, extractos botánicos y cero azúcar para acompañar energía natural, enfoque y cuidado diario.',
  description = 'Café latte funcional listo para tomar, con 10g de colágeno marino, vitaminas B6, B12 y D3, minerales y extractos botánicos. Una forma práctica y premium de integrar café, colágeno y bienestar a tu rutina diaria.',
  usage_moment = 'Mañana, oficina o estudio.',
  main_benefit = 'Tu café diario, elevado: 10g de colágeno marino, vitaminas B6, B12 y D3, extractos botánicos y cero azúcar.',
  how_to_use = 'Agítalo bien, sírvelo frío sobre hielo y disfrútalo solo o con tu leche favorita. Ideal para la mañana, oficina o estudio cuando quieres café, enfoque y una rutina funcional más práctica.',
  usage_description = 'MASH Coffee+ combina café latte premium con colágeno marino, vitaminas y extractos botánicos en una bebida fría, práctica, sin azúcar y baja en calorías.',
  routine_suggestion = jsonb_build_array(
    'Refrigéralo para disfrutarlo bien frío.',
    'Agítalo bien antes de tomar.',
    'Sírvelo sobre hielo o mézclalo con tu leche favorita.',
    'Disfrútalo en la mañana, oficina o estudio como tu café funcional diario.'
  ),
  benefits = jsonb_build_array(
    '10g de colágeno marino por lata para complementar tu rutina diaria de cuidado personal.',
    'Vitaminas B6 y B12 para acompañar el metabolismo energético normal.',
    'Vitamina D3 como parte de una rutina de bienestar diario.',
    'Cafeína natural del café para apoyar enfoque y energía diaria.',
    'Extractos botánicos seleccionados para acompañar digestión, balance y bienestar funcional.',
    'Sin azúcar y bajo en calorías.'
  ),
  bullets = jsonb_build_array(
    '10g colágeno marino',
    'Vitaminas B6, B12 y D3',
    'Cero azúcar',
    'Café funcional listo para tomar'
  ),
  functional_claims = jsonb_build_array(
    'Café funcional con colágeno marino.',
    'Rutina diaria de bienestar en formato listo para tomar.',
    'Energía natural del café para acompañar enfoque y productividad.',
    'Extractos botánicos, vitaminas y minerales en una bebida premium.'
  ),
  ingredients_summary = 'Water, coffee concentrate, fish collagen peptides 10g, vitaminas B6, B12, D3, vitamina C, vitamina E, minerales, extractos botánicos funcionales, EGCG, sucralosa y potassium sorbate. Sin azúcar.'
where slug = 'mash-coffee';

update public.products
set
  category = 'Café funcional',
  commercial_category = 'Café funcional con colágeno marino',
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
  target_customer = 'Personas que quieren tener café funcional listo para varios días, con colágeno marino, vitaminas y cero azúcar.',
  nicho = 'Bienestar y Salud Natural; Cuidado Personal y Belleza Natural; Rutina semanal',
  problema_resuelve = 'Personas que quieren integrar café funcional a su semana sin comprar una unidad cada día ni complicar su rutina.',
  expected_benefit = 'Pack semanal de café funcional con 10g de colágeno marino por lata, vitaminas B6, B12 y D3, extractos botánicos y cero azúcar.',
  description = 'Pack de 6 latas de café latte funcional con colágeno marino, vitaminas y extractos botánicos. Pensado para mantener tu café funcional disponible durante la semana.',
  usage_moment = 'Semana de oficina, estudio o rutina activa.',
  main_benefit = 'Tu café funcional para varios días: práctico, frío, sin azúcar y listo para acompañar mañanas, oficina o estudio.',
  how_to_use = 'Refrigéralo, agítalo y llévalo contigo. Úsalo como parte de tu rutina semanal cuando quieres café práctico, rico y funcional.',
  usage_description = 'El 6 Pack convierte MASH Coffee+ en una rutina semanal: café latte funcional con colágeno marino, vitaminas y cero azúcar, listo cuando lo necesitas.',
  routine_suggestion = jsonb_build_array(
    'Guarda el pack en refrigeración.',
    'Elige una lata para tu mañana, oficina o estudio.',
    'Agítala bien y sírvela sobre hielo si deseas.',
    'Repite durante la semana como parte de tu ritual funcional.'
  ),
  benefits = jsonb_build_array(
    '6 latas listas para acompañar tu semana.',
    '10g de colágeno marino por lata.',
    'Vitaminas B6, B12 y D3 para una rutina diaria de bienestar.',
    'Cafeína natural del café para apoyar enfoque y energía diaria.',
    'Sin azúcar, bajo en calorías y práctico para llevar.',
    'Ideal para casa, oficina o estudio.'
  ),
  bullets = jsonb_build_array(
    '6 latas',
    'Rutina semanal',
    '10g colágeno por lata',
    'Cero azúcar'
  ),
  functional_claims = jsonb_build_array(
    'Pack práctico para mantener café funcional disponible.',
    'Café latte con colágeno marino, vitaminas y extractos botánicos.',
    'Formato ideal para oficina, estudio y rutina semanal.'
  ),
  ingredients_summary = 'Cada lata contiene café concentrate, fish collagen peptides 10g, vitaminas B6, B12, D3, vitamina C, vitamina E, minerales, extractos botánicos funcionales, EGCG, sucralosa y potassium sorbate. Sin azúcar.'
where slug = 'mash-coffee-6pack';

update public.products
set
  category = 'Café funcional',
  commercial_category = 'Café funcional con colágeno marino',
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
  target_customer = 'Consumidores que ya quieren integrar MASH Coffee+ a su rutina diaria y buscan abastecimiento inteligente para casa, oficina o estudio.',
  nicho = 'Bienestar y Salud Natural; Cuidado Personal y Belleza Natural; Abastecimiento inteligente',
  problema_resuelve = 'Personas que no quieren quedarse sin su café funcional durante la semana y prefieren comprar más unidades con mejor conveniencia.',
  expected_benefit = 'Abastecimiento de café funcional premium con 10g de colágeno marino por lata, vitaminas B6, B12 y D3, extractos botánicos y cero azúcar.',
  description = 'Pack de 12 latas de café latte funcional con colágeno marino, vitaminas y extractos botánicos. Una compra inteligente para mantener tu rutina funcional siempre lista.',
  usage_moment = 'Rutina diaria, casa, oficina o estudio.',
  main_benefit = 'Abastece tu rutina con café funcional premium: 10g de colágeno marino por lata, vitaminas y cero azúcar.',
  how_to_use = 'Mantén el pack refrigerado y disfruta una lata cuando quieras café funcional listo para tomar. Ideal para casa, oficina, estudio o compartir.',
  usage_description = 'El 12 Pack está pensado para quienes quieren tener MASH Coffee+ siempre disponible: café latte funcional con colágeno marino, vitaminas, extractos botánicos y cero azúcar.',
  routine_suggestion = jsonb_build_array(
    'Organiza el pack en casa u oficina.',
    'Refrigera las latas para tenerlas listas.',
    'Toma una lata en tu mañana, jornada de trabajo o estudio.',
    'Úsalo como tu abastecimiento funcional de la semana.'
  ),
  benefits = jsonb_build_array(
    '12 latas para mantener tu rutina abastecida.',
    '10g de colágeno marino por lata.',
    'Vitaminas B6, B12 y D3 para acompañar bienestar diario.',
    'Cafeína natural del café para apoyar enfoque y energía diaria.',
    'Sin azúcar y bajo en calorías.',
    'Ideal para casa, oficina, estudio o compra familiar.'
  ),
  bullets = jsonb_build_array(
    '12 latas',
    'Compra inteligente',
    '10g colágeno por lata',
    'Cero azúcar'
  ),
  functional_claims = jsonb_build_array(
    'Abastecimiento premium de café funcional.',
    'Café latte con colágeno marino, vitaminas y extractos botánicos.',
    'Formato ideal para rutina diaria y compra planificada.'
  ),
  ingredients_summary = 'Cada lata contiene café concentrate, fish collagen peptides 10g, vitaminas B6, B12, D3, vitamina C, vitamina E, minerales, extractos botánicos funcionales, EGCG, sucralosa y potassium sorbate. Sin azúcar.'
where slug = 'mash-coffee-12pack';

update public.products
set
  category = 'Desayuno funcional',
  commercial_category = 'Pancake alto en proteína y fibra',
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
  target_customer = 'Personas activas, familias, estudiantes y consumidores que quieren desayunar rico con más proteína, fibra y practicidad.',
  nicho = 'Fitness, Rendimiento y Recuperación; Bienestar y Salud Natural; Desayuno funcional',
  problema_resuelve = 'Personas que quieren desayunar rico, pero no quieren empezar el día con una comida pesada, poco nutritiva o llena de azúcar.',
  expected_benefit = 'Pancakes y waffles altos en proteína y fibra para disfrutar un desayuno rico, práctico y más completo desde la primera comida del día.',
  description = 'Mezcla funcional para pancakes y waffles altos en proteína y fibra, creada para quienes quieren desayunar rico, sentirse satisfechos y mantener una rutina más inteligente sin complicarse en la cocina.',
  usage_moment = 'Desayuno, después del gym o snack saludable.',
  main_benefit = 'Pancakes altos en proteína y fibra para disfrutar un desayuno rico, práctico y más completo.',
  how_to_use = 'Mezcla una porción con huevo y leche hasta lograr una textura suave. Cocina como pancake o waffle hasta que quede doradito y acompáñalo con frutas, yogurt o tu topping favorito.',
  usage_description = 'Convierte tu desayuno en una opción más inteligente con proteína, fibra funcional, avena, konjac, inulina y minerales en una mezcla fácil de preparar.',
  routine_suggestion = jsonb_build_array(
    'Mezcla con huevo y leche hasta lograr una textura suave.',
    'Cocina en sartén o wafflera hasta que quede doradito.',
    'Sirve con frutas, yogurt o tu topping favorito.',
    'Disfrútalo como desayuno, snack o después del gym.'
  ),
  benefits = jsonb_build_array(
    'Alto en proteína: 24.7g por 100g.',
    'Fuente de fibra: 11.5g por 100g.',
    'Ayuda a sentirte satisfecho por más tiempo.',
    'Bajo en grasa.',
    'Sin azúcar añadida, endulzado con eritritol.',
    'Con avena, konjac, inulina y fibra de arveja.',
    'Fácil de preparar como pancake o waffle.'
  ),
  bullets = jsonb_build_array(
    'Alto en proteína',
    'Fuente de fibra',
    'Fácil de preparar',
    'Pancake o waffle'
  ),
  functional_claims = jsonb_build_array(
    'Desayuno funcional alto en proteína y fibra.',
    'Mezcla práctica para pancakes y waffles.',
    'Pensado para saciedad, rutina fitness y desayuno inteligente.',
    'Una forma rica de cuidar tu primera comida del día.'
  ),
  ingredients_summary = 'Eritritol, proteína de arveja, gluten de trigo, proteína de soya hidrolizada, harina de avena, dextrina resistente, fibra de arveja, konjac, inulina, bicarbonato de sodio, calcio, zinc e hierro. Contiene cereales con gluten.'
where slug = 'mash-nutri-pancake';

update public.products
set
  name = 'MASH NUTRA+ Pan Proteico',
  category = 'Pan proteico',
  commercial_category = 'Pan proteico bajo en carbohidratos',
  strategic_niche_id = (
    select id
    from public.strategic_niches
    where slug = 'salud-funcionalidad-especifica'
  ),
  primary_subniche_id = (
    select id
    from public.strategic_subniches
    where slug = 'salud-digestiva'
  ),
  target_customer = 'Personas que quieren seguir disfrutando pan, tostadas y sándwiches con una opción alta en proteína, alta en fibra y baja en carbohidratos.',
  nicho = 'Salud y Funcionalidad Específica; Fitness, Rendimiento y Recuperación; Nutrición low carb',
  problema_resuelve = 'Personas que aman el pan, pero buscan una alternativa más funcional para cuidar su rutina sin dejar tostadas, sándwiches ni comidas prácticas.',
  expected_benefit = 'Pan proteico bajo en carbohidratos, alto en proteína y fibra, ideal para tostadas, sándwiches y comidas prácticas sin sacrificar tu rutina.',
  description = 'Mezcla funcional para preparar pan alto en proteína, alto en fibra y bajo en carbohidratos, pensada para quienes quieren disfrutar pan casero de una forma más inteligente.',
  usage_moment = 'Desayuno, comida o snack saludable.',
  main_benefit = 'El pan que sí encaja con tu rutina: alto en proteína, alto en fibra y bajo en carbohidratos.',
  how_to_use = 'Mezcla la harina con agua y levadura. Cuando la masa esté bien integrada, añade un poco de mantequilla y hornea hasta obtener un pan suave, dorado y listo para tostadas, sándwiches o acompañamientos.',
  usage_description = 'MASH NUTRA+ te permite volver a disfrutar pan casero con una fórmula alta en proteína, alta en fibra y baja en carbohidratos.',
  routine_suggestion = jsonb_build_array(
    'Mezcla con agua y levadura.',
    'Integra bien la masa y agrega un poco de mantequilla.',
    'Hornea hasta que el pan quede suave y dorado.',
    'Úsalo para tostadas, sándwiches o acompañar tus comidas.'
  ),
  benefits = jsonb_build_array(
    'Alto en proteína: 53.6g por 100g.',
    'Alto en fibra: 22.6g por 100g.',
    'Bajo en carbohidratos: 11.1g por 100g.',
    'Bajo en azúcares: 1.2g por 100g.',
    'Ideal para tostadas, sándwiches y comidas prácticas.',
    'Con konjac, inulina, fibra de arveja y dextrina resistente.',
    'Fácil de preparar en casa.'
  ),
  bullets = jsonb_build_array(
    'Alto en proteína',
    'Alto en fibra',
    'Bajo en carbohidratos',
    'Ideal para sándwiches'
  ),
  functional_claims = jsonb_build_array(
    'Pan casero alto en proteína y fibra.',
    'Alternativa baja en carbohidratos para tostadas y sándwiches.',
    'Diseñado para comidas prácticas y nutrición inteligente.',
    'Una forma más funcional de seguir disfrutando pan.'
  ),
  ingredients_summary = 'Gluten de trigo, proteína de arveja, eritritol, dextrina resistente, fibra de arveja, konjac, harina de avena, harina de tapioca, inulina, sal y extracto de frijol blanco. Contiene cereales con gluten.'
where slug = 'mash-nutri-pan';

commit;
