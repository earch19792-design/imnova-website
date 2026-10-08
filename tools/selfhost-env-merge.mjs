import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

function fail(message) {
  console.error(`BLOCKED ${message}`)
  process.exit(1)
}

const [sourceArg, targetArg, ...names] = process.argv.slice(2)
if (!sourceArg || !targetArg || names.length === 0) {
  fail("usage: node tools/selfhost-env-merge.mjs <source> <target> <NAME...>")
}

const cwd = `${path.resolve(process.cwd())}${path.sep}`
const target = path.resolve(targetArg)
if (!`${target}${path.sep}`.startsWith(cwd) && !target.startsWith(cwd)) {
  fail("target must stay inside the repository")
}

function envLines(contents) {
  const values = new Map()
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u)
    if (match) values.set(match[1], match[2])
  }
  return values
}

const sourceText = await readFile(path.resolve(sourceArg), "utf8")
let targetText = await readFile(target, "utf8")
const source = envLines(sourceText)

for (const name of names) {
  const value = source.get(name)
  if (!value || value.replaceAll('"', "").trim() === "[SENSITIVE]") {
    fail(`${name} is unavailable in the source file`)
  }
  const expression = new RegExp(`^${name}=.*$`, "mu")
  if (!expression.test(targetText)) fail(`${name} is missing in the target file`)
  targetText = targetText.replace(expression, `${name}=${value}`)
  console.log(`MERGED ${name}`)
}

await writeFile(target, targetText, { encoding: "utf8", mode: 0o600 })
