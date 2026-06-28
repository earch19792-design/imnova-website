export const listingStrategyTemplate = {
  id: "listing_strategy_template_v0",
  name: "Listing Strategy Template V0",
  human_approval_required:
    true,
  mode:
    "read_only_static_template",
  combines: [
    "seller_decision",
    "readiness",
    "title",
    "images",
    "description",
    "item_specifics",
    "price",
    "shipping",
    "pack",
    "launch",
    "risks",
    "final_conclusion",
  ],
  final_review_order: [
    "Confirm active eBay listing risks first: out-of-stock, price-up, stale mapping, or margin risk must be reviewed before new listing prep.",
    "Confirm readiness blockers first.",
    "Confirm seller decision and account risk.",
    "Confirm title follows verified buyer search language.",
    "Confirm images are authorized and resolve buyer objections.",
    "Confirm description avoids unsupported claims.",
    "Confirm item specifics and category are complete.",
    "Confirm price and margin pass.",
    "Confirm shipping is reliable.",
    "Confirm pack path if unit economics or stock require it.",
    "Confirm organic launch and observation plan.",
    "Confirm final human approval before any real action.",
  ],
  conclusion_schema: {
    active_listing_risk_status:
      "clear | needs_review | critical_blocker",
    seller_decision:
      "string",
    readiness_status:
      "blocked | needs_review | ready_for_prep",
    recommended_listing_path:
      "do_not_list | organic_test | pack_review | listing_prep",
    blocked_actions:
      [],
    allowed_next_steps:
      [],
    risks:
      [],
    final_conclusion:
      "string",
    human_approval_required:
      true,
  },
  forbidden_actions: [
    "auto_publish_listing",
    "create_real_ebay_draft",
    "call_ebay_api",
    "pause_real_listing",
    "start_campaign_without_observation",
  ],
}
