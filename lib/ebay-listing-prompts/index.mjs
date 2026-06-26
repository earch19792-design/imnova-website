export {
  listingReadinessTemplate,
} from "./listing-readiness-template.mjs"
export {
  titleOptimizerTemplate,
} from "./title-optimizer-template.mjs"
export {
  imageConversionTemplate,
} from "./image-conversion-template.mjs"
export {
  descriptionConverterTemplate,
} from "./description-converter-template.mjs"
export {
  launchObservationTemplate,
} from "./launch-observation-template.mjs"
export {
  listingStrategyTemplate,
} from "./listing-strategy-template.mjs"

import {
  listingReadinessTemplate,
} from "./listing-readiness-template.mjs"
import {
  titleOptimizerTemplate,
} from "./title-optimizer-template.mjs"
import {
  imageConversionTemplate,
} from "./image-conversion-template.mjs"
import {
  descriptionConverterTemplate,
} from "./description-converter-template.mjs"
import {
  launchObservationTemplate,
} from "./launch-observation-template.mjs"
import {
  listingStrategyTemplate,
} from "./listing-strategy-template.mjs"

export const listingSellerAdvisorPromptsV0 = {
  id: "listing_seller_advisor_prompts_v0",
  principle:
    "Readiness first, creativity after.",
  human_approval_required:
    true,
  mode:
    "read_only_static_templates",
  templates: [
    listingReadinessTemplate,
    titleOptimizerTemplate,
    imageConversionTemplate,
    descriptionConverterTemplate,
    launchObservationTemplate,
    listingStrategyTemplate,
  ],
}
