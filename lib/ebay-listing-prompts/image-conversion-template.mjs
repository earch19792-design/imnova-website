export const imageConversionTemplate = {
  id: "image_conversion_template_v0",
  name: "Image Conversion Template V0",
  human_approval_required:
    true,
  mode:
    "read_only_static_template",
  image_count:
    7,
  principle:
    "Images must reduce buyer uncertainty before they try to decorate the listing.",
  images: [
    {
      slot:
        1,
      role:
        "main_click_image",
      commercial_goal:
        "Win the click with a clear, honest product-first image.",
      buyer_objection_resolved:
        "Is this the exact item I searched for?",
      suggested_visual_prompt:
        "Clean product image on a plain light background, full item visible, accurate color and quantity, no extra props.",
      must_not_include:
        "No logos not on the product, no badges, no fake discounts, no invented accessories.",
    },
    {
      slot:
        2,
      role:
        "trust_quality_material",
      commercial_goal:
        "Show quality, material, texture, or finish.",
      buyer_objection_resolved:
        "Will this feel cheap or different from the listing?",
      suggested_visual_prompt:
        "Close-up detail of material, finish, label, texture, or construction using verified product visuals.",
      must_not_include:
        "No exaggerated quality claims, no unverified certifications.",
    },
    {
      slot:
        3,
      role:
        "package_contents",
      commercial_goal:
        "Clarify exactly what the buyer receives.",
      buyer_objection_resolved:
        "How many are included and what comes in the package?",
      suggested_visual_prompt:
        "Flat lay of all included items with accurate quantity and no extra accessories.",
      must_not_include:
        "No items that are not included, no bundle quantity not validated.",
    },
    {
      slot:
        4,
      role:
        "dimensions_size",
      commercial_goal:
        "Reduce size mismatch returns.",
      buyer_objection_resolved:
        "Will this fit my intended use or space?",
      suggested_visual_prompt:
        "Product with simple dimension callouts using verified measurements.",
      must_not_include:
        "No estimated dimensions, no unverified compatibility.",
    },
    {
      slot:
        5,
      role:
        "benefit_in_action",
      commercial_goal:
        "Show the practical use case without overstating results.",
      buyer_objection_resolved:
        "How would I use this and why does it help?",
      suggested_visual_prompt:
        "Product shown in a realistic use case with neutral, factual benefit framing.",
      must_not_include:
        "No medical claims, no guaranteed outcomes, no invented performance.",
    },
    {
      slot:
        6,
      role:
        "lifestyle_context",
      commercial_goal:
        "Help the buyer imagine ownership while keeping the product clear.",
      buyer_objection_resolved:
        "Does this match my environment or need?",
      suggested_visual_prompt:
        "Lifestyle scene with the product in a relevant setting, product still visible and truthful.",
      must_not_include:
        "No misleading scale, no unrelated premium props.",
    },
    {
      slot:
        7,
      role:
        "scale_hands_real_use",
      commercial_goal:
        "Show scale through hands, placement, or real use.",
      buyer_objection_resolved:
        "How big is it in real life?",
      suggested_visual_prompt:
        "Product held or placed near a common object to show accurate scale.",
      must_not_include:
        "No distorted perspective, no inaccurate size comparison.",
    },
  ],
}
