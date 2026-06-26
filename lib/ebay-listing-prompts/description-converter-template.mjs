export const descriptionConverterTemplate = {
  id: "description_converter_template_v0",
  name: "Description Converter Template V0",
  human_approval_required:
    true,
  mode:
    "read_only_static_template",
  language:
    "en",
  required_sections: [
    "What it is",
    "Who it is for",
    "Key benefits",
    "Features",
    "What is included",
    "Shipping/handling note",
    "Trust note",
  ],
  prompt:
    "Write an English eBay description using only verified product facts. Keep it clear, buyer-focused, and conservative. Do not invent data.",
  forbidden_content: [
    "medical claims",
    "unverified promises",
    "exaggerations",
    "unauthorized brands",
    "invented data",
    "unvalidated compatibility",
    "automatic publishing instructions",
    "real draft creation instructions",
  ],
  output_schema: {
    what_it_is:
      "string",
    who_it_is_for:
      "string",
    key_benefits:
      [],
    features:
      [],
    what_is_included:
      [],
    shipping_handling_note:
      "string",
    trust_note:
      "string",
    risk_notes:
      [],
  },
}
