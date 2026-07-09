# Amazon Referral Fee Schedule Category Resolver V1

## Why

LOOP 149E calculaba referral fee con una tasa configurable simple. Eso era suficiente para un primer profit guard, pero Amazon cobra referral fees por categoria. Un producto puede verse rentable con una tasa generica y perder margen cuando se aplica la categoria correcta.

Este patch agrega un baseline local de referral fees proporcionado por el usuario y un resolver por categoria, precio y regla.

## Current state

- Amazon Track ya tiene 149A-149F integrados.
- 149E calcula fees, profit guard y ROI.
- Este patch mejora 149E con un referral fee schedule local.
- No usa Amazon API.
- No usa SP-API.
- No usa Seller Central.
- No usa scraping.
- No publica nada.

## Por que referral fee por categoria mejora ROI

Referral fee impacta directamente:

- net profit;
- net margin percent;
- ROI percent;
- break-even price;
- minimum profitable price;
- decision de watchlist o rechazo.

Un 8%, 15%, 20% o 45% cambia completamente la decision de producto.

## Estimacion local vs fee oficial verificada

Esta tabla es un baseline local proporcionado por el usuario. No es una confirmacion viva de Amazon.

Antes de listing real, Seller Central o SP-API debe verificar:

- categoria final;
- fee preview real;
- fulfillment fee real;
- restricciones;
- eligibility;
- referral fee aplicable.

## Categorias cubiertas

El fixture incluye categorias como Amazon Device Accessories, Appliances, Automotive, Baby, Beauty, Clothing, Computers, Consumer Electronics, Electronics Accessories, Grocery, Home and Kitchen, Jewelry, Pet Supplies, Tools and Home Improvement, Watches, Everything Else y otras categorias de la tabla provista.

## Regla simple

Una regla simple aplica un porcentaje directo al sale price.

Ejemplo:

- Computers
- price: 100
- rate: 8%
- referral fee: 8.00

## Price band

Una regla price band selecciona el porcentaje segun el precio total.

Ejemplo:

- Beauty, Health, and Personal Care
- price <= 10: 8%
- price > 10: 15%

## Tiered portion

Una regla tiered portion aplica porcentajes por porcion del precio.

Ejemplo:

- Electronics Accessories
- 15% hasta 100
- 8% sobre la porcion arriba de 100
- price 150: 15.00 + 4.00 = 19.00

## Minimum referral fee

Algunas categorias tienen minimum referral fee de 0.30 o 1.00. Otras no tienen minimo. El resolver solo aplica minimo cuando la tabla lo define.

## Ejemplo DM0628N

- Producto: Glisten Dishwasher Detergent Booster & Freshener 28 oz
- Categoria probable: Home and Kitchen
- Sale price: 22.99
- Referral fee: 15%
- Referral fee amount: approx 3.45

El producto puede tener ROI calculado, pero sigue bloqueado para listing package si hazmat, chemical review o Seller Central eligibility estan pendientes.

## Integracion con 149E

149E ahora agrega:

- referralFeeScheduleVersion;
- referralFeeCategory;
- referralFeeRuleType;
- referralFeeAmount;
- effectiveReferralFeePercent;
- referralFeeMinimumApplied;
- referralFeeCategoryConfidence;
- sellerCentralFeeVerified false;
- spApiFeeVerified false;
- referralFeeWarnings.

El dry-run de 149E reporta si el schedule fue usado, cuantas categorias se resolvieron y cuantas quedaron inciertas.

## Por que no usamos Amazon API/SP-API todavia

Este patch es un baseline local para mejorar decisiones antes de integracion real. Usar SP-API requiere cuenta, credenciales, scopes, eligibility y controles de seguridad adicionales.

## Verificacion futura

Seller Central o SP-API deberan validar fees reales antes de produccion. El resolver no declara tarifas oficiales vivas.

## Safety boundaries

- No Production touch.
- No main touch.
- No Staging DB write.
- No Amazon API.
- No SP-API.
- No Seller Central write.
- No scraper.
- No publication.
- No ASIN/listing creation.
- No Codex/OpenAI API.
- No WhatsApp real.
- No `.env`, secrets, tokens, dumps, backups o imagenes.

## Definition of Done

- Fixture de referral fee schedule creado.
- Modulo puro creado.
- CLI dry-run creado.
- Tests cubren reglas simples, bandas, porciones escalonadas, minimo, no minimo, fallback y special case.
- 149E consume el resolver.
- 149E dry-run reporta schedule usado.
- TypeScript y regresiones pasan.
- Git status queda limpio.

## Human explanation rule

Explicar siempre que el referral fee es baseline local, no fee oficial verificado. Reportar categoria, precio, fee amount, porcentaje efectivo, warnings y si requiere verificacion Seller Central/SP-API.

## Next step

149G - Amazon Listing Package Builder.
