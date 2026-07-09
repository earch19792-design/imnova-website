# Amazon Luna FBA Prep Packing Costs V1

## Why

Amazon profitability cannot stop at referral fee and fulfillment estimates. A product can look profitable before warehouse handling, FNSKU labels, bundle work, boxes, pallet allocation, FBM materials, and Amazon Professional seller plan allocation. This loop models those operational add-ons locally before the Amazon Listing Package Builder.

## Current state

This is a local dry-run baseline from user-provided Luna Warehouse documents:

- No Amazon API.
- No SP-API.
- No Seller Central write.
- No scraper.
- No publication.
- No production write.
- No Staging DB write.

The Luna costs are user-provided operational costs. They are not Amazon FBA fulfillment fees. Amazon FBA fulfillment fees remain separate estimates and must be verified later through Seller Central or SP-API before real selling decisions.

## FBA Fulfillment Fee vs Luna Prep Cost

Amazon FBA fulfillment fee estimates represent Amazon's cost to fulfill the order.

Luna FBA prep and packing costs represent warehouse-side operational work before the inventory is sent to FBA: reception, FNSKU labels, bundles, wrapping, boxes, and pallet wrapping.

Both can affect ROI, but they are different cost layers.

## Inventory Reception

- $0.00 per unit when inventory is prepared and sent to FBA with Luna.
- $0.20 per unit when inventory is not sent to FBA.

## FNSKU

- Luna clients: $0.50 per unit.
- External clients: $0.80 per unit.
- This applies only when the product does not require additional preparation.

## Bundles / Packages

Luna clients:

- 1 unit: $0.60
- 3 units: $0.80
- 6 units: $1.00
- 12 units: $1.25
- More than 12 units: quote required

External clients:

- 1 unit: $1.00
- 3 units: $1.25
- 6 units: $1.50
- 12 units: $2.00
- More than 12 units: quote required

## Bundles / Wrap

Luna clients:

- 1 unit: $1.00
- 3 units: $1.25
- 6 units: $1.75
- 12 units: $2.00

External clients:

- 1 unit: $1.50
- 3 units: $2.00
- 6 units: $2.50
- 12 units: $3.00

## Boxes

Luna clients:

- Small box: $2.00
- Medium box: $3.00
- Large box: $4.00

External clients:

- Small box: $3.00
- Medium box: $4.00
- Large box: $5.00

## Pallets

- Pallet plus wrapping: $10.00
- The model can allocate this per unit when `unitsPerPallet` is known.

## FBM Packing Materials

The FBM materials document defines requirements, but does not provide prices per pack. IMNOVA OS must not invent those costs.

Materials are modeled with `costStatus: NEED_UNIT_COST_INPUT` until the user provides cost per pack:

- Thermal printer
- Shipping labels 4x6
- FN-SKU labels 2x1
- Bundle stickers
- Poly bags with Suffocation Warning
- Team Lift stickers
- Combined warning stickers
- Large scale
- Small scale
- FBM poly mailers
- FBM bubble mailers

## Amazon Professional Seller Plan Fee Allocation

The Professional seller plan is modeled as:

- Monthly fee: $39.99
- Per-unit allocation: `39.99 / expectedMonthlyUnits`

Examples:

- 10 units/month: $4.00 per unit
- 50 units/month: $0.80 per unit
- 100 units/month: $0.40 per unit

If expected monthly units are missing or zero, the dry-run keeps fee per unit at $0.00 and emits `NEED_EXPECTED_MONTHLY_UNITS`.

## DM0628N Example

DM0628N uses the conservative local scenario:

- Fulfillment path: FBA
- Customer type: Luna client
- FNSKU labeling: $0.50
- Expected monthly units: 50
- Professional plan allocation: $0.80
- Total operational add-on: $1.30

This reduces the after-add-on profit view, but does not unlock listing package. DM0628N remains blocked by hazmat, chemical, and manual review gates.

## Integration With 149E

149E now reports:

- Net profit before operational add-ons.
- Net profit after operational add-ons.
- ROI after operational add-ons.
- Margin after operational add-ons.
- Break-even price after operational add-ons.
- Minimum profitable price after operational add-ons.

## Safety Boundaries

- No Production touch.
- No main touch.
- No Staging DB write.
- No Amazon API/SP-API.
- No Seller Central write.
- No scraper.
- No publication.
- No secrets.

## Definition of Done

- Luna prep and packing rules are modeled locally.
- FBM materials remain requirements when costs are missing.
- Professional plan fee allocation is modeled.
- 149E uses the operational cost stack.
- Tests and dry-runs pass.

## Human Explanation Rule

The system must explain that the product has two profitability views: before and after operational add-ons. It must also explain that FBM material costs are incomplete until the user provides real pack costs.

## Next Step

149G - Amazon Listing Package Builder.
