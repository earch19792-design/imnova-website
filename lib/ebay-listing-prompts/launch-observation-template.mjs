export const launchObservationTemplate = {
  id: "launch_observation_template_v0",
  name: "Launch Observation Template V0",
  human_approval_required:
    true,
  mode:
    "read_only_static_template",
  default_launch:
    "organic_first",
  initial_campaign:
    "off",
  observe_metrics: [
    "impressions",
    "clicks",
    "watchers",
    "conversion",
    "sales",
  ],
  optimization_rules: [
    {
      condition:
        "impressions_low",
      action:
        "Review title keyword, category, item specifics, and price positioning.",
    },
    {
      condition:
        "impressions_good_clicks_low",
      action:
        "Review main image, title clarity, price, shipping promise, and first-screen trust signals.",
    },
    {
      condition:
        "clicks_good_no_watchers_or_sales",
      action:
        "Review price, shipping, description confidence, item specifics, and comparable listings.",
    },
    {
      condition:
        "watchers_no_sales",
      action:
        "Evaluate price test, offer strategy, or image/description friction before campaign.",
    },
  ],
  campaign_rules: [
    "Keep campaign off at launch.",
    "Evaluate 1%-2% campaign only after organic readiness and observation show buyer interest.",
    "Do not run campaign when stock is low, margin is thin, shipping is unreliable, supplier is unstable, or readiness is incomplete.",
    "Do not use campaign to compensate for missing item specifics, weak photos, bad price, or unconfirmed stock.",
  ],
}
