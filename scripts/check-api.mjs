#!/usr/bin/env node
/**
 * Smoke-test Hookr API routes. Usage:
 *   node scripts/check-api.mjs
 *   BASE=https://your-app.up.railway.app HOOKR_PASSWORD=xxx node scripts/check-api.mjs
 */
const BASE = process.env.BASE?.replace(/\/$/, "") || "http://localhost:3000";
const password = process.env.HOOKR_PASSWORD?.trim();

const routes = [
  { method: "GET", path: "/api/health", auth: false },
  { method: "POST", path: "/api/auth/login", auth: false, body: { password } },
  { method: "GET", path: "/api/auth/session", auth: true },
  { method: "GET", path: "/api/campaigns", auth: true },
  { method: "GET", path: "/api/library?scope=pickers", auth: true },
  { method: "GET", path: "/api/library?scope=create", auth: true },
  { method: "GET", path: "/api/library?scope=produce", auth: true },
  { method: "GET", path: "/api/library?scope=assets", auth: true },
  { method: "GET", path: "/api/library?scope=exports", auth: true },
  { method: "GET", path: "/api/library/captions", auth: true },
  { method: "GET", path: "/api/settings", auth: true },
  { method: "GET", path: "/api/instagram", auth: true },
];

async function request(path, { method = "GET", cookie = "", body } = {}) {
  const headers = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (body) headers["Content-Type"] = "application/json";
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { status: res.status, ms: Date.now() - started, size: text.length, json, text };
}

function summarize(path, json) {
  if (json?.error) return json.error.slice(0, 80);
  if (json?.ok === true && json?.database) {
    return `db=${json.database.ok} supabase=${json.supabase?.ok}`;
  }
  if (Array.isArray(json?.campaigns)) return `campaigns=${json.campaigns.length}`;
  if (Array.isArray(json?.hooks)) return `hooks=${json.hooks.length}`;
  if (Array.isArray(json?.exports)) return `exports=${json.exports.length}`;
  if (json?.authenticated != null) return `auth=${json.authenticated}`;
  if (json?.configured != null) return `configured=${json.configured}`;
  if (json?.captions) return `captions=${json.captions.length}`;
  if (json?.ok != null) return `ok=${json.ok}`;
  return "";
}

async function main() {
  console.log(`Checking ${BASE}\n`);
  let cookie = "";

  for (const route of routes) {
    if (route.path === "/api/auth/login") {
      if (!password) {
        console.log("SKIP POST /api/auth/login (set HOOKR_PASSWORD)");
        continue;
      }
      const login = await request(route.path, { method: "POST", body: route.body });
      const setCookie = login.json?.ok
        ? (await fetch(`${BASE}${route.path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(route.body),
          })).headers.getSetCookie?.() ?? []
        : [];
      cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
      console.log(
        `${login.status === 200 ? "PASS" : "FAIL"} ${String(login.ms).padStart(4)}ms ${route.method} ${route.path} :: ok=${login.json?.ok}`,
      );
      continue;
    }

    if (route.auth && !cookie) {
      console.log(`SKIP ${route.method} ${route.path} (not logged in)`);
      continue;
    }

    const res = await request(route.path, {
      method: route.method,
      cookie: route.auth ? cookie : "",
    });
    const ok = res.status >= 200 && res.status < 300;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${String(res.ms).padStart(4)}ms ${String(res.size).padStart(6)}b ${route.method} ${route.path} :: ${summarize(route.path, res.json) || res.text.slice(0, 60)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
