with listing as (
  select
    ebay_item_id,
    ebay_price::numeric as sale_price,
    title,
    raw_payload
  from public.ebay_active_listings
  where ebay_item_id = '366543596425'
    and listing_status = 'active'
  order by
    case source
      when 'EBAY_SELL_INVENTORY_READONLY' then 3
      when 'EBAY_TRADING_GET_ITEM_READONLY' then 2
      else 1
    end desc,
    updated_at desc
  limit 1
), package as (
  select
    listing.sale_price,
    (listing.raw_payload ->> 'listingPackageId')::uuid as listing_package_id,
    package.package_data
  from listing
  join public.ebay_listing_packages as package
    on package.id = (listing.raw_payload ->> 'listingPackageId')::uuid
), base as (
  select
    sale_price,
    (package_data #>> '{pricing,supplierCost}')::numeric as supplier_cost
  from package
), scenarios(
  scenario_order,
  scenario,
  final_value_fee_rate,
  promoted_rate,
  returns_rate,
  shipping_cost
) as (
  values
    (1, 'Monitor conservador actual', 0.153::numeric, 0.05::numeric, 0.04::numeric, 6.99::numeric),
    (2, 'Tarifa 13.6%; reservas iguales', 0.136::numeric, 0.05::numeric, 0.04::numeric, 6.99::numeric),
    (3, 'Tarifa 13.6%; sin cargo publicitario', 0.136::numeric, 0::numeric, 0.04::numeric, 6.99::numeric),
    (4, 'Tarifa 13.6%; sin publicidad ni reserva de devolucion', 0.136::numeric, 0::numeric, 0::numeric, 6.99::numeric)
), calculated as (
  select
    scenarios.*,
    base.sale_price,
    base.supplier_cost,
    base.sale_price * scenarios.final_value_fee_rate + 0.40 as ebay_fee,
    base.sale_price * scenarios.returns_rate as returns_reserve,
    base.sale_price * scenarios.promoted_rate as promoted_reserve
  from base
  cross join scenarios
)
select
  scenario_order,
  scenario,
  round(sale_price, 2) as sale_price,
  round(supplier_cost, 2) as supplier_cost,
  final_value_fee_rate,
  promoted_rate,
  returns_rate,
  round(shipping_cost, 2) as shipping_cost,
  round(ebay_fee, 2) as ebay_fee,
  round(returns_reserve, 2) as returns_reserve,
  round(promoted_reserve, 2) as promoted_reserve,
  round(
    sale_price - supplier_cost - shipping_cost - ebay_fee
      - returns_reserve - promoted_reserve,
    2
  ) as estimated_net_profit,
  round(
    (
      sale_price - supplier_cost - shipping_cost - ebay_fee
        - returns_reserve - promoted_reserve
    ) / sale_price * 100,
    2
  ) as estimated_margin_percent
from calculated
order by scenario_order;
