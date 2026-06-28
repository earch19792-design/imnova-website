export const listingReadinessTemplate = {
  id: "listing_readiness_template_v0",
  name: "Listing Readiness Template V0",
  principle:
    "Readiness first, creativity after.",
  human_approval_required:
    true,
  mode:
    "read_only_static_template",
  purpose:
    "Decide whether listing preparation may continue before title, image, description, or launch prompts are used.",
  required_inputs: [
    "active_ebay_listing_risk_review",
    "confirmed_stock",
    "weight_or_dimensions",
    "authorized_images",
    "category_and_item_specifics",
    "sufficient_margin",
    "reliable_shipping",
    "viable_supplier",
    "pack_strategy_if_applicable",
    "low_stock_or_cancellation_risk_review",
  ],
  blocking_rules: [
    {
      field:
        "active_ebay_listing_risk_review",
      severity:
        "block",
      message:
        "Before preparing a new listing, review active eBay listings for out-of-stock, price-up, stale mapping, or margin risk. Protect active listings before pursuing new opportunities.",
    },
    {
      field:
        "confirmed_stock",
      severity:
        "block",
      message:
        "Do not prepare a listing without confirmed stock at variant level.",
    },
    {
      field:
        "weight_or_dimensions",
      severity:
        "block",
      message:
        "Do not finalize price or shipping until weight or dimensions are confirmed.",
    },
    {
      field:
        "authorized_images",
      severity:
        "block",
      message:
        "Do not use images unless they are authorized for listing use.",
    },
    {
      field:
        "category_and_item_specifics",
      severity:
        "warn",
      message:
        "Category and item specifics must be reviewed before listing prep is complete.",
    },
    {
      field:
        "sufficient_margin",
      severity:
        "block",
      message:
        "Do not publish or draft if margin does not pass the seller threshold.",
    },
    {
      field:
        "reliable_shipping",
      severity:
        "block",
      message:
        "Do not publish or draft if shipping cost, speed, or handling path is unreliable.",
    },
    {
      field:
        "viable_supplier",
      severity:
        "block",
      message:
        "Do not prepare a listing if supplier availability or cost is not viable.",
    },
    {
      field:
        "pack_strategy_if_applicable",
      severity:
        "warn",
      message:
        "If unit economics fail but pack strategy may work, review pack path before discarding or listing.",
    },
    {
      field:
        "low_stock_or_cancellation_risk_review",
      severity:
        "block",
      message:
        "Low stock or cancellation risk can block campaign, pack, draft, and publication even when margin is good.",
    },
  ],
  allowed_after_pass:
    "Proceed to creative prompts only after readiness blockers are resolved and human approval is recorded.",
  forbidden_actions: [
    "auto_publish_listing",
    "create_real_ebay_draft",
    "call_ebay_api",
    "pause_real_listing",
    "start_campaign",
    "invent_missing_data",
  ],
}
