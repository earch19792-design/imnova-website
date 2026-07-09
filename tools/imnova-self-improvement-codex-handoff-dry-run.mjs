import { readFileSync } from "node:fs";

import {
  buildCodexHandoffQueue,
  summarizeCodexHandoffQueue,
} from "../lib/imnova/imnova-self-improvement-codex-handoff.ts";

function readJsonFixture(relativePath) {
  return JSON.parse(
    readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ),
  );
}

const fixture =
  readJsonFixture("./fixtures/imnova-self-improvement-codex-handoff-v1.json");
const queue =
  buildCodexHandoffQueue(fixture);
const summary =
  summarizeCodexHandoffQueue(queue);

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
