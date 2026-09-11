/** Read-only presentation. Workflow/health never grant writes or prove an owner task. */
export type MayelOwnerActionEvidenceV1 = {
  ownerActionRequired?: boolean;
  ownerAction?: { required: boolean; humanOnly: boolean; proven: boolean; action: string; reasonCode: string; sourceReference: string };
  listingOperationalHealth?: string;
}
export function mayelOwnerActionPresentationV1(e: MayelOwnerActionEvidenceV1 & { state: string }) {
  const a = e.ownerAction
  const provenHumanAction = Boolean(a?.required === true && a.humanOnly === true && a.proven === true &&
    typeof a.action === "string" && a.action.trim() && typeof a.reasonCode === "string" && a.reasonCode.trim() &&
    typeof a.sourceReference === "string" && a.sourceReference.trim())
  const required = e.ownerActionRequired === true || provenHumanAction
  return {
    mayelWorkflowState: e.state,
    // Missing health evidence is UNKNOWN, never inferred from a visual workflow failure.
    listingOperationalHealth: e.listingOperationalHealth ?? "UNKNOWN",
    ownerActionState: required ? "REQUIRED" as const : "NONE_REQUIRED" as const,
    ownerActionRequired: required,
    ownerCtaPresent: required && provenHumanAction,
    ownerActionMessage: required ? provenHumanAction ? a!.action : "Hay una acción pendiente del owner; consulta su evidencia en Ver detalles." : "No necesitas hacer nada",
  }
}
