const schedulerOrigin = process.env.LOCAL_SCHEDULER_ORIGIN?.trim()
  || "http://web:3000"
const cronSecret = process.env.CRON_SECRET?.trim() || ""
const dryRun = process.env.LOCAL_SCHEDULER_DRY_RUN !== "false"
const once = process.env.LOCAL_SCHEDULER_ONCE === "true"
const instanceKey = process.env.LOCAL_SCHEDULER_INSTANCE_KEY?.trim()
  || "seller-os-windows-workstation"

const cronJobs = Object.freeze([
  {
    name: "amazon-connie-readonly-sync",
    path: "/api/cron/amazon-connie-readonly-sync",
    method: "POST",
    everyMinutes: 360,
    minuteOffset: 23,
    maxCatchUpMinutes: 1_440,
    catchUp: true,
    timeoutMs: 330_000,
  },
  {
    name: "quick-pick-runtime-recovery",
    path: "/api/cron/quick-pick-runtime-recovery",
    method: "POST",
    everyMinutes: 1_440,
    // 07:20 UTC, matching the former pg_cron schedule. This heavy lane stays
    // on the private Docker network and must not block the other cron jobs.
    minuteOffset: 7 * 60 + 20,
    maxCatchUpMinutes: 2_880,
    catchUp: true,
    timeoutMs: 1_800_000,
  },
  {
    name: "commercial-monitor",
    path: "/api/cron/ebay-commercial-monitor",
    method: "POST",
    everyMinutes: 5,
    minuteOffset: 0,
    maxCatchUpMinutes: 1_440,
    catchUp: true,
    timeoutMs: 330_000,
  },
  {
    name: "commercial-alert-dispatcher",
    path: "/api/cron/commercial-alert-dispatcher",
    method: "POST",
    everyMinutes: 1,
    minuteOffset: 0,
    maxCatchUpMinutes: 1_440,
    catchUp: true,
    timeoutMs: 90_000,
  },
  {
    name: "owner-sale-alerts",
    path: "/api/cron/ebay-owner-sale-alerts",
    method: "POST",
    everyMinutes: 5,
    minuteOffset: 0,
    maxCatchUpMinutes: 1_440,
    catchUp: true,
    timeoutMs: 90_000,
  },
])

const queueJob = Object.freeze({
  name: "top20-continuation-queue",
  path: "/api/queues/ebay-listing-top20-continuation",
  method: "POST",
  everySeconds: 5,
  timeoutMs: 330_000,
  // pgmq already owns durable delivery and visibility; a second receipt per
  // five-second empty poll would add noise without improving recoverability.
  durableClaim: false,
})

const fastLunaBatchJob = Object.freeze({
  name: "fast-luna-test-batch",
  path: "/api/cron/quick-pick-runtime-recovery",
  method: "POST",
  everySeconds: 10,
  timeoutMs: 1_800_000,
  runtimeLane: "FAST_LUNA_TEST_BATCH_V1",
  // The durable batch and child ledgers already own single-flight,
  // idempotency, official readback and replay state.
  durableClaim: false,
})

function validatedOrigin(value) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username ||
      url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("LOCAL_SCHEDULER_ORIGIN_INVALID")
  }
  return url
}

function safeLog(event, values = {}) {
  console.info(JSON.stringify({
    event,
    observedAt: new Date().toISOString(),
    ...values,
  }))
}

function safeOutcomeCode(value) {
  const normalized = String(value || "UNKNOWN").toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_").slice(0, 80)
  return normalized.length >= 2 ? normalized : "UNKNOWN"
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value : {}
}

const origin = validatedOrigin(schedulerOrigin)
if (!dryRun && cronSecret.length < 16) {
  throw new Error("LOCAL_SCHEDULER_CRON_SECRET_REQUIRED")
}
if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(instanceKey)) {
  throw new Error("LOCAL_SCHEDULER_INSTANCE_KEY_INVALID")
}

const running = new Set()
const completedSlots = new Map()
let runtimeSessionId = null

async function control(action, input = {}) {
  const response = await fetch(new URL("/api/runtime/selfhost-control", origin), {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
      "User-Agent": "imnova-selfhost-scheduler/2.0",
    },
    body: JSON.stringify({ action, ...input }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = record(await response.json().catch(() => ({})))
  if (!response.ok || body.success !== true) {
    throw new Error("SELFHOST_RUNTIME_CONTROL_UNAVAILABLE")
  }
  return record(body.result)
}

async function startRuntimeSession() {
  if (dryRun) return []
  const result = await control("STARTUP", {
    instanceKey,
    startedAt: new Date().toISOString(),
    jobs: cronJobs.map((job) => ({ name: job.name,
      everyMinutes: job.everyMinutes, minuteOffset: job.minuteOffset,
      maxCatchUpMinutes: job.maxCatchUpMinutes, catchUp: job.catchUp })),
  })
  if (typeof result.sessionId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(result.sessionId)) {
    throw new Error("SELFHOST_RUNTIME_SESSION_INVALID")
  }
  runtimeSessionId = result.sessionId
  const catchUp = Array.isArray(result.catchUp) ? result.catchUp : []
  safeLog("scheduler_runtime_session_started", {
    resumedFromGap: result.resumedFromGap === true,
    resumeGapSeconds: Number.isSafeInteger(result.resumeGapSeconds)
      ? result.resumeGapSeconds : null,
    catchUpCandidateCount: catchUp.length,
  })
  return catchUp
}

async function claimJob(job, slot, triggerKind) {
  if (dryRun || job.durableClaim === false) return { claimed: true, runId: null }
  if (!runtimeSessionId) throw new Error("SELFHOST_RUNTIME_SESSION_REQUIRED")
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await control("CLAIM_JOB", {
        sessionId: runtimeSessionId,
        jobName: job.name,
        scheduledSlot: slot,
        triggerKind,
        leaseSeconds: Math.min(14_400,
          Math.ceil(job.timeoutMs / 1_000) + 300),
        observedAt: new Date().toISOString(),
      })
      return { claimed: result.claimed === true,
        runId: typeof result.runId === "string" ? result.runId : null,
        status: typeof result.status === "string" ? result.status : "UNKNOWN" }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error("SELFHOST_RUNTIME_CLAIM_UNAVAILABLE")
}

async function completeJob(claim, result) {
  if (!runtimeSessionId || !claim.runId) return
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await control("COMPLETE_JOB", {
        sessionId: runtimeSessionId,
        runId: claim.runId,
        succeeded: result.succeeded,
        httpStatus: result.httpStatus,
        outcomeCode: safeOutcomeCode(result.outcomeCode),
        elapsedMs: result.elapsedMs,
        completedAt: new Date().toISOString(),
      })
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error("SELFHOST_RUNTIME_COMPLETION_UNAVAILABLE")
}

async function invoke(job, slot, triggerKind = "SCHEDULE") {
  // The queue is already durable in pgmq. Pausing empty/frequent polls while
  // the bounded Quick Pick repair lane is active avoids needless Supabase
  // contention without losing work.
  if (job.name === queueJob.name &&
      running.has("quick-pick-runtime-recovery")) return
  if (running.has(job.name) || completedSlots.get(job.name) === slot) return
  completedSlots.set(job.name, slot)
  if (dryRun) {
    safeLog("scheduler_job_dry_run", {
      job: job.name,
      path: job.path,
      slot,
      triggerKind,
    })
    return
  }

  running.add(job.name)
  const startedAt = Date.now()
  let claim = { claimed: false, runId: null, status: "UNCLAIMED" }
  let completion = null
  try {
    claim = await claimJob(job, slot, triggerKind)
    if (!claim.claimed) {
      safeLog("scheduler_job_claim_skipped", {
        job: job.name, slot, triggerKind, status: claim.status,
      })
      return
    }
    const response = await fetch(new URL(job.path, origin), {
      method: job.method,
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "X-Ebay-Commercial-Authorization": `Bearer ${cronSecret}`,
        "User-Agent": "imnova-selfhost-scheduler/2.0",
        ...(job.runtimeLane
          ? { "X-Seller-OS-Runtime-Lane": job.runtimeLane } : {}),
      },
      signal: AbortSignal.timeout(job.timeoutMs),
    })
    // 409/423 are intentional single-flight or policy deferrals from the
    // protected runtime. The scheduler reached the lane correctly and must
    // not manufacture an infrastructure failure while the source remains
    // safely gated (for example, an exhausted eBay Trading quota).
    const deferred = response.status === 409 || response.status === 423
    const succeeded = response.ok || response.status === 204 || deferred
    const declaredOutcome = safeOutcomeCode(
      response.headers.get("x-seller-os-runtime-outcome"))
    completion = { succeeded, httpStatus: response.status,
      outcomeCode: deferred
        ? declaredOutcome !== "UNKNOWN" ? declaredOutcome
          : response.status === 409 ? "DEFERRED_ALREADY_RUNNING"
            : "DEFERRED_POLICY_GATE"
        : succeeded ? "HTTP_SUCCESS" : `HTTP_${response.status}`,
      elapsedMs: Date.now() - startedAt }
    safeLog("scheduler_job_completed", {
      job: job.name,
      httpStatus: response.status,
      ok: succeeded,
      elapsedMs: completion.elapsedMs,
      slot,
      triggerKind,
    })
  } catch (error) {
    const timeout = error instanceof Error && /timeout|abort/i.test(
      `${error.name}:${error.message}`)
    completion = { succeeded: false, httpStatus: null,
      outcomeCode: timeout ? "TIMEOUT" : "NETWORK_ERROR",
      elapsedMs: Date.now() - startedAt }
    safeLog("scheduler_job_failed", {
      job: job.name,
      error: completion.outcomeCode,
      elapsedMs: completion.elapsedMs,
      slot,
      triggerKind,
    })
  } finally {
    if (claim.claimed && completion) {
      try {
        await completeJob(claim, completion)
      } catch {
        safeLog("scheduler_job_completion_receipt_failed", {
          job: job.name, slot, triggerKind,
        })
      }
    }
    running.delete(job.name)
  }
}

async function runCatchUpPlan(plan) {
  for (const candidate of plan) {
    const item = record(candidate)
    const job = cronJobs.find((entry) => entry.name === item.name)
    const slot = Number(item.scheduledSlot)
    if (job && Number.isSafeInteger(slot) && slot > 0) {
      await invoke(job, slot, "CATCH_UP")
    }
  }
}

async function runHeartbeatLoop() {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 60_000))
    try {
      await control("HEARTBEAT", { sessionId: runtimeSessionId,
        observedAt: new Date().toISOString() })
    } catch {
      safeLog("scheduler_runtime_heartbeat_failed")
    }
  }
}

async function runCronLoop() {
  while (true) {
    const now = new Date()
    const minuteSlot = Math.floor(now.getTime() / 60_000)
    const due = cronJobs.filter((job) =>
      (minuteSlot - job.minuteOffset) % job.everyMinutes === 0)
    for (const job of due) void invoke(job, minuteSlot, "SCHEDULE")
    await new Promise((resolve) => setTimeout(
      resolve,
      60_050 - (Date.now() % 60_000),
    ))
  }
}

async function runQueueLoop() {
  while (true) {
    const slotMs = queueJob.everySeconds * 1_000
    const slot = Math.floor(Date.now() / slotMs)
    await invoke(queueJob, slot, "QUEUE")
    await new Promise((resolve) => setTimeout(
      resolve,
      slotMs + 50 - (Date.now() % slotMs),
    ))
  }
}

async function runFastLunaBatchLoop() {
  while (true) {
    const slotMs = fastLunaBatchJob.everySeconds * 1_000
    const slot = Math.floor(Date.now() / slotMs)
    await invoke(fastLunaBatchJob, slot, "AUTHORIZED_BATCH")
    await new Promise((resolve) => setTimeout(
      resolve,
      slotMs + 50 - (Date.now() % slotMs),
    ))
  }
}

safeLog("scheduler_started", {
  dryRun,
  cronJobCount: cronJobs.length,
  queuePollingSeconds: queueJob.everySeconds,
  fastLunaBatchPollingSeconds: fastLunaBatchJob.everySeconds,
  originHost: origin.hostname,
  durableResume: !dryRun,
})

const catchUpPlan = await startRuntimeSession()
if (once) {
  const slot = Math.floor(Date.now() / 60_000)
  await Promise.allSettled([
    ...cronJobs.map((job) => invoke(job, slot, "ONCE")),
    invoke(queueJob, Math.floor(Date.now() / 5_000), "QUEUE"),
    invoke(fastLunaBatchJob, Math.floor(Date.now() / 10_000),
      "AUTHORIZED_BATCH"),
  ])
} else {
  void runCatchUpPlan(catchUpPlan)
  await Promise.all([runCronLoop(), runQueueLoop(), runFastLunaBatchLoop(),
    runHeartbeatLoop()])
}
