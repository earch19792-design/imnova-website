const schedulerOrigin = process.env.LOCAL_SCHEDULER_ORIGIN?.trim()
  || "http://web:3000"
const cronSecret = process.env.CRON_SECRET?.trim() || ""
const dryRun = process.env.LOCAL_SCHEDULER_DRY_RUN !== "false"
const once = process.env.LOCAL_SCHEDULER_ONCE === "true"

const cronJobs = Object.freeze([
  {
    name: "amazon-connie-readonly-sync",
    path: "/api/cron/amazon-connie-readonly-sync",
    method: "POST",
    everyMinutes: 360,
    minuteOffset: 23,
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
    timeoutMs: 1_800_000,
  },
  {
    name: "commercial-monitor",
    path: "/api/cron/ebay-commercial-monitor",
    method: "POST",
    everyMinutes: 5,
    timeoutMs: 330_000,
  },
  {
    name: "commercial-alert-dispatcher",
    path: "/api/cron/commercial-alert-dispatcher",
    method: "POST",
    everyMinutes: 1,
    timeoutMs: 90_000,
  },
  {
    name: "owner-sale-alerts",
    path: "/api/cron/ebay-owner-sale-alerts",
    method: "POST",
    everyMinutes: 5,
    timeoutMs: 90_000,
  },
])

const queueJob = Object.freeze({
  name: "top20-continuation-queue",
  path: "/api/queues/ebay-listing-top20-continuation",
  method: "POST",
  everySeconds: 5,
  timeoutMs: 330_000,
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

const origin = validatedOrigin(schedulerOrigin)
if (!dryRun && cronSecret.length < 16) {
  throw new Error("LOCAL_SCHEDULER_CRON_SECRET_REQUIRED")
}

const running = new Set()
const completedSlots = new Map()

async function invoke(job, slot) {
  if (running.has(job.name) || completedSlots.get(job.name) === slot) {
    return
  }
  completedSlots.set(job.name, slot)
  if (dryRun) {
    safeLog("scheduler_job_dry_run", {
      job: job.name,
      path: job.path,
      slot,
    })
    return
  }

  running.add(job.name)
  const startedAt = Date.now()
  try {
    const response = await fetch(new URL(job.path, origin), {
      method: job.method,
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "X-Ebay-Commercial-Authorization": `Bearer ${cronSecret}`,
        "User-Agent": "imnova-selfhost-scheduler/1.0",
      },
      signal: AbortSignal.timeout(job.timeoutMs),
    })
    safeLog("scheduler_job_completed", {
      job: job.name,
      httpStatus: response.status,
      ok: response.ok || response.status === 204,
      elapsedMs: Date.now() - startedAt,
      slot,
    })
  } catch (error) {
    safeLog("scheduler_job_failed", {
      job: job.name,
      error: error instanceof Error && /timeout|abort/i.test(
        `${error.name}:${error.message}`,
      ) ? "TIMEOUT" : "NETWORK_ERROR",
      elapsedMs: Date.now() - startedAt,
      slot,
    })
  } finally {
    running.delete(job.name)
  }
}

async function runCronLoop() {
  while (true) {
    const now = new Date()
    const minuteSlot = Math.floor(now.getTime() / 60_000)
    const due = cronJobs.filter((job) => {
      const minuteOffset = job.minuteOffset ?? 0
      return (minuteSlot - minuteOffset) % job.everyMinutes === 0
    })
    for (const job of due) void invoke(job, minuteSlot)
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
    await invoke(queueJob, slot)
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
  originHost: origin.hostname,
})

if (once) {
  const slot = Math.floor(Date.now() / 60_000)
  await Promise.allSettled([
    ...cronJobs.map((job) => invoke(job, slot)),
    invoke(queueJob, slot),
  ])
} else {
  await Promise.all([runCronLoop(), runQueueLoop()])
}
