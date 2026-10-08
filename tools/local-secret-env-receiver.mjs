import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const host = "127.0.0.1";
const port = Number(process.env.LOCAL_SECRET_RECEIVER_PORT || "52139");
const token = process.env.LOCAL_SECRET_RECEIVER_TOKEN;
const envFile = path.resolve(
  process.env.LOCAL_SECRET_ENV_FILE || ".env.selfhost.production",
);

const allowedKeys = new Set([
  "AMAZON_CONNIE_SKU_PREFIX",
  "AMAZON_SP_API_LWA_CLIENT_ID",
  "AMAZON_SP_API_LWA_CLIENT_SECRET",
  "AMAZON_SP_API_MARKETPLACE_ID",
  "AMAZON_SP_API_REFRESH_TOKEN",
  "AMAZON_SP_API_SELLER_ID",
  "CLOUDFLARE_TUNNEL_TOKEN",
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN",
  "EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID",
  "EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET",
  "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT",
  "EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN",
  "EBAY_MARKETING_READONLY_REFRESH_TOKEN",
  "EBAY_RuName",
  "EBAY_SELLER_REFRESH_TOKEN",
]);

if (!token) {
  throw new Error("LOCAL_SECRET_RECEIVER_TOKEN is required");
}

function send(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sendTransferForm(response) {
  const inputs = [...allowedKeys]
    .map(
      (key) =>
        `<label>${escapeHtml(key)}<input type="password" name="${escapeHtml(key)}" autocomplete="off"></label>`,
    )
    .join("\n");
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  });
  response.end(`<!doctype html>
<html lang="es"><meta charset="utf-8"><title>Transferencia local protegida</title>
<style>body{font-family:system-ui;max-width:760px;margin:32px auto;padding:0 20px}form{display:grid;gap:12px}label{display:grid;gap:4px;font-weight:600}input{font:inherit;padding:8px}button{font:inherit;padding:10px}</style>
<h1>Transferencia local protegida</h1>
<p>Los valores se guardan únicamente en el archivo de entorno local.</p>
<form method="post" action="/form?token=${encodeURIComponent(token)}">
${inputs}
<button type="submit">Guardar localmente</button>
</form></html>`);
}

function updateEnv(values) {
  let source = fs.readFileSync(envFile, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";

  for (const [key, value] of Object.entries(values)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported environment key: ${key}`);
    }
    if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
      throw new Error(`Invalid value for ${key}`);
    }
    if (/[\r\n]/.test(value)) {
      throw new Error(`Multiline value rejected for ${key}`);
    }

    const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const nextLine = `${key}="${escaped}"`;
    const linePattern = new RegExp(`^${key}=.*$`, "m");
    if (linePattern.test(source)) {
      source = source.replace(linePattern, nextLine);
    } else {
      if (source.length > 0 && !source.endsWith("\n")) source += eol;
      source += `${nextLine}${eol}`;
    }
  }

  fs.writeFileSync(envFile, source, { encoding: "utf8", mode: 0o600 });
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/" &&
    requestUrl.searchParams.get("token") === token
  ) {
    sendTransferForm(response);
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "60",
    });
    response.end();
    return;
  }

  const isJsonTransfer = request.method === "POST" && requestUrl.pathname === "/transfer";
  const isFormTransfer = request.method === "POST" && requestUrl.pathname === "/form";
  if ((!isJsonTransfer && !isFormTransfer) || requestUrl.searchParams.get("token") !== token) {
    send(response, 404, { ok: false });
    return;
  }

  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 100_000) request.destroy();
  });
  request.on("end", () => {
    try {
      const parsed = isJsonTransfer ? JSON.parse(body) : null;
      const values = isJsonTransfer
        ? parsed?.values
        : Object.fromEntries(
            [...new URLSearchParams(body).entries()].filter(([, value]) => value !== ""),
          );
      if (!values || typeof values !== "object" || Array.isArray(values)) {
        throw new Error("Expected a values object");
      }
      updateEnv(values);
      if (isFormTransfer) {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(
          `<!doctype html><html lang="es"><meta charset="utf-8"><title>Guardado</title><h1>Guardado localmente</h1><p>${Object.keys(values).length} valores actualizados.</p></html>`,
        );
        process.stdout.write(`UPDATED_KEYS ${Object.keys(values).join(",")}\n`);
        return;
      }
      send(response, 200, { ok: true, keys: Object.keys(values) });
      process.stdout.write(`UPDATED_KEYS ${Object.keys(values).join(",")}\n`);
    } catch (error) {
      send(response, 400, { ok: false });
      process.stderr.write(`TRANSFER_ERROR ${error.message}\n`);
    }
  });
});

server.listen(port, host, () => {
  process.stdout.write(`LOCAL_SECRET_RECEIVER_READY ${host}:${port}\n`);
});
