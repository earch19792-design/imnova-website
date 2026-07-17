# eBay Market Intelligence Loop

`EBAY_MARKET_INTELLIGENCE_LOOP_V1` converts up to ten manually observed eBay
comparables into an evidence-labeled market report. It does not scrape eBay,
call an eBay API, infer private sales, or generate competitor-derived listing
copy.

## Inputs

Use the shape exported by
`lib/ebay/market-intelligence/types.ts`. Every competitor requires an overall
`evidenceLevel`. Use `fieldEvidence` to override that level for individual
fields. Missing values become `unavailable`; quantities derived from
`quantityIncluded * unitsPerPackage` become `inferred`.

Visual fields are manual observations. Supplying only an image URL does not
produce a visual classification. Optional `mainImageAnalysis` and
`secondaryImageClassifications` hold the human review.

## Run locally

```bash
npm run market-intelligence:ebay -- \
  --input /absolute/path/input.json \
  --output-dir /absolute/path/output
```

The runner writes:

- `report.json`
- `report.md`

To replace the `competitorListings` array with a separate manual file:

```bash
npm run market-intelligence:ebay -- \
  --input /absolute/path/input.json \
  --competitors /absolute/path/competitors.csv \
  --output-dir /absolute/path/output
```

The competitors file may be JSON or CSV. JSON contains an array of competitor
objects. CSV uses the same field names as headers. Array/object cells such as
`secondaryImageUrls`, `itemSpecifics`, `fieldEvidence`, `badges`,
`mainImageAnalysis`, and `secondaryImageClassifications` contain JSON.

## Price and evidence rules

- Landed price is item price plus shipping.
- Price per package uses `quantityIncluded`.
- Price per unit uses `totalUnitCount`; a derived count remains labeled
  `inferred`.
- Used/refurbished, international, bundled, or critically incomplete listings
  remain in `excludedListings` and do not affect primary price metrics.
- Visible sold counts receive high weighting. Seller reputation, handling and
  listing quality receive medium weighting. Unsupported extreme prices receive
  low weighting.
- `floorPrice` is break-even after configured percentage fees.
- Launch, competitive, target, premium, and volume prices cannot undercut the
  price required for the requested target margin.
- When sold counts are absent, the report uses the phrase `demand signals`, not
  confirmed sales.
