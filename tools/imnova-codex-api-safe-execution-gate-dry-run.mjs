import { readFileSync } from "node:fs";

import {
  buildCodexSafeExecutionGateQueue,
  summarizeCodexSafeExecutionGateQueue,
} from "../lib/imnova/imnova-codex-api-safe-execution-gate.ts";

function readJsonFixture(relativePath) {
  return JSON.parse(
    readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ),
  );
}

const fixture =
  readJsonFixture("./fixtures/imnova-codex-api-safe-execution-gate-v1.json");
const queue =
  buildCodexSafeExecutionGateQueue(fixture);
const summary =
  summarizeCodexSafeExecutionGateQueue(
    queue,
    fixture,
  );

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
