type Row = Record<string, unknown>

export const SAME_DAY_CONTINUITY_RESCUE_VERSION =
  "SELLER_OS_CONTINUITY_RESCUE_V1_2026_07_25"

export type SameDayContinuityRescueMode =
  | "NO_ACTIVE_RUN"
  | "SAFE_AUTOMATIC_RESUME"
  | "WAITING_HUMAN_GATE"
  | "FINAL_AUTHORIZATION_REQUIRED"
  | "PUBLICATION_RECONCILIATION_REQUIRED"
  | "MANUAL_CORRECTION_REQUIRED"
  | "TERMINAL"

export type SameDayContinuityRescueAssessment = {
  version: typeof SAME_DAY_CONTINUITY_RESCUE_VERSION
  mode: SameDayContinuityRescueMode
  canRunAutomaticRescue: boolean
  runId: string | null
  candidateId: string | null
  machineState: string | null
  openHumanGate: string | null
  reasonCode: string
  nextAction: string
  safety: {
    usesExistingStateMachine: true
    preservesCheckpoints: true
    skipsStates: false
    fabricatesEvidence: false
    grantsHumanApproval: false
    callsEbayDirectly: false
    finalHumanAuthorizationRequired: true
  }
}

const SETTLED_MACHINE_STATES = new Set([
  "REJECTED",
  "BLOCKED",
  "VERIFIED_ACTIVE",
  "COMPLETED",
])

const PUBLICATION_RECONCILIATION_STATES = new Set([
  "WAITING_ITEM_ID",
  "VERIFYING_PUBLISHED_LISTING",
  "REGISTERING_COMMERCIAL_MONITOR",
])

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(object) : []
}

function assessment(
  mode: SameDayContinuityRescueMode,
  context: {
    runId?: string
    candidateId?: string
    machineState?: string
    openHumanGate?: string
    reasonCode: string
    nextAction: string
  },
): SameDayContinuityRescueAssessment {
  return {
    version: SAME_DAY_CONTINUITY_RESCUE_VERSION,
    mode,
    canRunAutomaticRescue: mode === "SAFE_AUTOMATIC_RESUME",
    runId: context.runId || null,
    candidateId: context.candidateId || null,
    machineState: context.machineState || null,
    openHumanGate: context.openHumanGate || null,
    reasonCode: context.reasonCode,
    nextAction: context.nextAction,
    safety: {
      usesExistingStateMachine: true,
      preservesCheckpoints: true,
      skipsStates: false,
      fabricatesEvidence: false,
      grantsHumanApproval: false,
      callsEbayDirectly: false,
      finalHumanAuthorizationRequired: true,
    },
  }
}

/**
 * Diagnoses the durable pilot without changing it. The rescue lane is only an
 * operator-triggered entry point to the existing worker and never a parallel
 * state machine or publication implementation.
 */
export function evaluateSameDayContinuityRescue(
  snapshotValue: unknown,
): SameDayContinuityRescueAssessment {
  const snapshot = object(snapshotValue)
  const run = object(snapshot.run)
  const runId = text(run.id)
  if (!runId) {
    return assessment("NO_ACTIVE_RUN", {
      reasonCode: "SAME_DAY_CONTINUITY_NO_ACTIVE_RUN",
      nextAction: "Iniciar un lanzamiento acotado desde el flujo normal.",
    })
  }

  const candidates = rows(snapshot.candidates)
    .sort((left, right) => Number(left.ordinal ?? 0) - Number(right.ordinal ?? 0))
  const openTask = rows(snapshot.tasks).find((task) => text(task.status) === "OPEN")
  if (text(openTask?.gate_type) === "MANUAL_PUBLICATION_REQUIRED") {
    const candidate = candidates.find((entry) =>
      text(entry.id) === text(openTask?.candidate_id))
    return assessment("FINAL_AUTHORIZATION_REQUIRED", {
      runId,
      candidateId: text(openTask?.candidate_id),
      machineState: text(candidate?.machine_state),
      openHumanGate: "MANUAL_PUBLICATION_REQUIRED",
      reasonCode: "SAME_DAY_CONTINUITY_FINAL_AUTHORIZATION_REQUIRED",
      nextAction:
        "Revisar el preflight final y autorizar personalmente la publicación.",
    })
  }
  if (text(openTask?.gate_type) === "ITEM_ID_REQUIRED") {
    const candidate = candidates.find((entry) =>
      text(entry.id) === text(openTask?.candidate_id))
    return assessment("PUBLICATION_RECONCILIATION_REQUIRED", {
      runId,
      candidateId: text(openTask?.candidate_id),
      machineState: text(candidate?.machine_state),
      openHumanGate: "ITEM_ID_REQUIRED",
      reasonCode: "SAME_DAY_CONTINUITY_PUBLICATION_RECONCILIATION_REQUIRED",
      nextAction:
        "Reconciliar el Item ID autorizado y verificar ACTIVE sin publicar otra vez.",
    })
  }
  if (openTask) {
    const candidate = candidates.find((entry) =>
      text(entry.id) === text(openTask.candidate_id))
    return assessment("WAITING_HUMAN_GATE", {
      runId,
      candidateId: text(openTask.candidate_id),
      machineState: text(candidate?.machine_state),
      openHumanGate: text(openTask.gate_type),
      reasonCode: "SAME_DAY_CONTINUITY_HUMAN_GATE_OPEN",
      nextAction: text(openTask.title) ||
        "Completar la tarea humana visible; el auxilio no puede aprobarla.",
    })
  }

  const readyCandidate = candidates.find((candidate) =>
    text(candidate.machine_state) === "READY_FOR_MANUAL_PUBLICATION")
  if (readyCandidate) {
    return assessment("FINAL_AUTHORIZATION_REQUIRED", {
      runId,
      candidateId: text(readyCandidate.id),
      machineState: "READY_FOR_MANUAL_PUBLICATION",
      reasonCode: "SAME_DAY_CONTINUITY_FINAL_AUTHORIZATION_REQUIRED",
      nextAction:
        "Revisar el preflight final y autorizar personalmente la publicación.",
    })
  }

  const publicationCandidate = candidates.find((candidate) =>
    PUBLICATION_RECONCILIATION_STATES.has(text(candidate.machine_state)))
  if (publicationCandidate) {
    return assessment("PUBLICATION_RECONCILIATION_REQUIRED", {
      runId,
      candidateId: text(publicationCandidate.id),
      machineState: text(publicationCandidate.machine_state),
      reasonCode: "SAME_DAY_CONTINUITY_PUBLICATION_RECONCILIATION_REQUIRED",
      nextAction:
        "Usar la reconciliación de publicación autorizada para verificar el Item ID y el estado ACTIVE sin publicar otra vez.",
    })
  }

  const unsettledCandidate = candidates.find((candidate) =>
    !SETTLED_MACHINE_STATES.has(text(candidate.machine_state)))
  const recoverableJob = rows(snapshot.jobs).find((job) =>
    ["PENDING", "LEASED", "WAITING_RETRY", "DEAD_LETTER"]
      .includes(text(job.status)))
  const target = Math.max(0, Number(run.target_new_listings ?? 0))
  const verified = Math.max(0, Number(run.verified_new_listings ?? 0))
  const targetPending = verified < target
  const sourceInventory = object(run.source_inventory)
  const candidateSetExhausted =
    sourceInventory.nextCandidateSetExhausted === true
  const runCanContinue = [
    "ACTIVE",
    "PARTIALLY_READY",
    "READY_FOR_OPERATOR",
    "BLOCKED",
    "COMPLETED",
  ].includes(text(run.status)) && targetPending && !candidateSetExhausted

  if (unsettledCandidate || recoverableJob || runCanContinue) {
    const candidate = unsettledCandidate ?? candidates.find((entry) =>
      text(entry.id) === text(recoverableJob?.candidate_id))
    return assessment("SAFE_AUTOMATIC_RESUME", {
      runId,
      candidateId: text(candidate?.id || recoverableJob?.candidate_id),
      machineState: text(candidate?.machine_state),
      reasonCode: unsettledCandidate
        ? "SAME_DAY_CONTINUITY_AUTOMATIC_STATE_RECOVERABLE"
        : recoverableJob
          ? "SAME_DAY_CONTINUITY_DURABLE_JOB_RECOVERABLE"
          : "SAME_DAY_CONTINUITY_NEXT_CANDIDATE_RECOVERABLE",
      nextAction:
        "Ejecutar el motor durable desde el último checkpoint válido.",
    })
  }

  if (targetPending) {
    return assessment("MANUAL_CORRECTION_REQUIRED", {
      runId,
      candidateId: text(candidates[0]?.id),
      machineState: text(candidates[0]?.machine_state),
      reasonCode: candidateSetExhausted
        ? "SAME_DAY_CONTINUITY_CANDIDATE_SET_EXHAUSTED"
        : "SAME_DAY_CONTINUITY_NO_SAFE_AUTOMATIC_PATH",
      nextAction: candidateSetExhausted
        ? "Aportar nuevos candidatos o corregir evidencia; el auxilio no forzará un producto."
        : "Corregir el bloqueo indicado y volver a ejecutar el diagnóstico.",
    })
  }

  return assessment("TERMINAL", {
    runId,
    candidateId: text(candidates[0]?.id),
    machineState: text(candidates[0]?.machine_state),
    reasonCode: "SAME_DAY_CONTINUITY_TARGET_SETTLED",
    nextAction: "No se requiere auxilio; el objetivo durable ya quedó resuelto.",
  })
}
