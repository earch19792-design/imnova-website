export const titleOptimizerTemplate = {
  id: "title_optimizer_template_v0",
  name: "Title Optimizer Template V0",
  human_approval_required:
    true,
  mode:
    "read_only_static_template",
  output_count:
    3,
  target_length:
    "60-80 characters",
  structure:
    "Product + Brand + Model/Variant + Feature + Size/Quantity + Relevant keyword",
  rules: [
    "Place the main buyer keyword near the beginning.",
    "Use plain search language a real buyer would type.",
    "Avoid unnecessary symbols.",
    "Do not repeat words.",
    "Do not make unverified claims.",
    "Do not use unauthorized brands.",
    "Do not add compatibility unless validated.",
    "Keep each title readable and specific.",
  ],
  prompt:
    "Generate three eBay title options between 60 and 80 characters using only verified product facts. Start with the primary keyword, include brand and variant only when authorized, and avoid unsupported claims.",
  output_schema: {
    titles:
      [
        {
          title:
            "string",
          character_count:
            "number",
          keyword_strategy:
            "string",
          risk_notes:
            [],
        },
      ],
  },
}
