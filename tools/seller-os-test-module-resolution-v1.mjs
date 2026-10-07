import { registerHooks } from "node:module"
import { existsSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export%20default%20%7B%7D", shortCircuit: true }
  if (specifier.startsWith("@/")) {
    const absolute = resolvePath(process.cwd(), specifier.slice(2))
    for (const suffix of ["", ".ts", ".mjs", ".js", "/index.ts"]) {
      if (existsSync(absolute + suffix)) return nextResolve(
        pathToFileURL(absolute + suffix).href, context)
    }
  }
  try { return nextResolve(specifier, context) } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw error
    for (const suffix of [".ts", ".mjs", ".js", "/index.ts"]) {
      const url = new URL(specifier + suffix, context.parentURL)
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
    }
    throw error
  }
} })
