export const campaignStatuses = [
  "Draft",
  "Scheduled",
  "Active",
  "Optimizing",
  "Completed",
  "Archived",
] as const;

export type CampaignStatus =
  (typeof campaignStatuses)[number];