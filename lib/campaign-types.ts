export const campaignTypes = [
  "Validación",
  "Audiencia",
  "Leads",
  "Prelanzamiento",
  "Lanzamiento",
  "Ventas",
  "Reactivación",
] as const;

export type CampaignType =
  (typeof campaignTypes)[number];