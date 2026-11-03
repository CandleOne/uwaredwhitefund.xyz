/*
 * Red&White Investment Competition API (Cloudflare Worker + D1)
 *
 * Mount alongside your existing routes. In your Worker's entry file:
 *
 *   import competition from "./competition-worker.js";
 *   export default {
 *     async fetch(req, env, ctx) {
 *       const res = await competition.fetch(req, env, ctx);
 *       if (res) return res;            // null means "not a competition route"
 *       return existingHandler(req, env, ctx);
 *     },
 *     scheduled: (evt, env, ctx) => ctx.waitUntil(competition.scheduled(evt, env)),
 *   };
 *
 * wrangler.toml additions:
 *
 *   [triggers]
 *   crons = ["*\/5 * * * *"]            # every 5 min, keeps pending funding moving
 *
 *   [[d1_databases]]
 *   binding = "DB"
 *   database_name = "competition"
 *   database_id = "<id>"
 *
 *   [vars]
 *   ALPACA_BROKER_BASE = "https://broker-api.sandbox.alpaca.markets"
 *   ALLOWED_ORIGINS    = "https://uwaredwhitefund.xyz,http://localhost:8000,http://127.0.0.1:8000"
 *   ACCOUNT_EMAIL_DOMAIN = "teams.uwaredwhitefund.xyz"   # must be a domain you control
 *   REG_OPEN    = "2026-11-01T00:00:00-06:00"
 *   REG_CLOSE   = "2026-11-14T23:59:59-06:00"
 *   COMP_START  = "2026-11-16T08:00:00-06:00"            # TODO: set real dates
 *   COMP_END    = "2027-02-16T16:00:00-06:00"
 *
 * Secrets (wrangler secret put ...): ALPACA_KEY, ALPACA_SECRET
 */

const STARTING_CAPITAL = 100000;
const MAX_MEMBERS = 4;
const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
const BROKER_SANDBOX_HOST = "broker-api.sandbox.alpaca.markets";

/* ---------- helpers ---------- */

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const h = { Vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Headers"] = "Content-Type, X-Team-Key, X-Admin-Token";
    h["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
  }
  return h;
}

function reply(req, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(req, env) },
  });
}

const fail = (req, env, status, error) => reply(req, env, { error }, status);

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getPhase(env, now = Date.now(), launchAt = null) {
  const t = (k) => (k === "COMP_START" && launchAt ? Date.parse(launchAt) : Date.parse(env[k]));
  const registrationOpen = now >= t("REG_OPEN") && now <= t("REG_CLOSE");
  const tradingOpen = now >= t("COMP_START") && now <= t("COMP_END");
  let phase = "upcoming";
  if (now > t("COMP_END")) phase = "closed";
  else if (tradingOpen) phase = "live";
  else if (now > t("REG_CLOSE")) phase = "waiting";
  else if (registrationOpen) phase = "registration";
  return {
    phase,
    registrationOpen,
    tradingOpen,
    regOpen: env.REG_OPEN,
    regClose: env.REG_CLOSE,
    compStart: launchAt || env.COMP_START,
    compEnd: env.COMP_END,
    startingCapital: STARTING_CAPITAL,
    countdown: { active: Boolean(launchAt) && now < Date.parse(launchAt), target: launchAt, now: new Date(now).toISOString() },
  };
}

/* The admin countdown stores a launch time that overrides COMP_START. */
async function launchOverride(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS competition_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const row = await env.DB.prepare("SELECT value FROM competition_settings WHERE key = 'launch_at'").first();
  return row?.value || null;
}

async function currentPhase(env) {
  return getPhase(env, Date.now(), await launchOverride(env));
}

async function setCountdown(req, env) {
  const body = await readJson(req);
  const target = Date.parse(body?.target);
  if (Number.isNaN(target)) return fail(req, env, 400, "Enter a valid countdown date and time.");
  if (target >= Date.parse(env.COMP_END)) return fail(req, env, 400, "The countdown must end before the competition end date.");
  await launchOverride(env);
  await env.DB.prepare("INSERT INTO competition_settings (key, value) VALUES ('launch_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(new Date(target).toISOString()).run();
  return reply(req, env, await currentPhase(env));
}

async function clearCountdown(req, env) {
  await launchOverride(env);
  await env.DB.prepare("DELETE FROM competition_settings WHERE key = 'launch_at'").run();
  return reply(req, env, await currentPhase(env));
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/* ---------- Alpaca Broker API ---------- */

let alpacaToken = null;
let alpacaTokenExpiresAt = 0;

async function alpacaAccessToken(env, scheduled = false) {
  if (!scheduled && alpacaToken && Date.now() < alpacaTokenExpiresAt) return alpacaToken;
  const authBase = new URL("https://authx.sandbox.alpaca.markets/v1/oauth2/token");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.ALPACA_KEY,
    client_secret: env.ALPACA_SECRET,
  });
  const res = await fetch(authBase, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Alpaca auth ${res.status} POST /v1/oauth2/token`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  alpacaToken = data.access_token;
  alpacaTokenExpiresAt = Date.now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000;
  return alpacaToken;
}

async function alpaca(env, path, init = {}, scheduled = false) {
  const brokerBase = new URL(env.ALPACA_BROKER_BASE);
  if (brokerBase.protocol !== "https:" || brokerBase.hostname !== BROKER_SANDBOX_HOST) {
    throw new Error("The competition can only connect to the Alpaca Broker API sandbox.");
  }
  const token = await alpacaAccessToken(env, scheduled);
  const res = await fetch(brokerBase.origin + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(`Alpaca ${res.status} ${init.method || "GET"} ${path}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/*
 * VERIFY against the sandbox docs / your Postman collection before launch:
 * the identity fields below are synthetic placeholders. Sandbox approval is driven by
 * test fixtures, so swap in the documented sample identity that returns an approved account.
 * Never put real personal data in these accounts.
 */
function accountPayload(env, team, ip) {
  const now = new Date().toISOString();
  return {
    account_type: "trading",
    contact: {
      email_address: `team-${team.id}@${env.ACCOUNT_EMAIL_DOMAIN}`,
      phone_number: "555-666-7788",
      street_address: ["100 Main St"],
      city: "Livingston",
      state: "AL",
      postal_code: "35470",
      country: "USA",
    },
    identity: {
      given_name: "Team",
      family_name: team.id,
      date_of_birth: "1990-01-01",
      tax_id: "661-010-666", // placeholder: use the sandbox sample
      tax_id_type: "USA_SSN",
      country_of_citizenship: "USA",
      country_of_birth: "USA",
      country_of_tax_residence: "USA",
      funding_source: ["employment_income"],
    },
    disclosures: {
      is_control_person: false,
      is_affiliated_exchange_or_finra: false,
      is_politically_exposed: false,
      immediate_family_exposed: false,
    },
    agreements: ["margin_agreement", "account_agreement", "customer_agreement"].map((agreement) => ({
      agreement,
      signed_at: now,
      ip_address: ip || "127.0.0.1",
    })),
  };
}

/* Idempotent: safe to call repeatedly while Alpaca queues sandbox funding. */
async function finishProvisioning(env, team, ip, scheduled = false) {
  let accountId = team.alpaca_account_id;
  const call = (path, init) => alpaca(env, path, init, scheduled);

  if (!accountId) {
    const acct = await call("/v1/accounts", { method: "POST", body: JSON.stringify(accountPayload(env, team, ip)) });
    accountId = acct.id;
    await env.DB.prepare("UPDATE teams SET alpaca_account_id = ?, status = 'pending_funding' WHERE id = ?")
      .bind(accountId, team.id)
      .run();
  }

  let account;
  for (let i = 0; i < 5; i++) {
    account = await call(`/v1/accounts/${accountId}`);
    if (account.status === "ACTIVE") break;
    if (i === 4) {
      console.log("Funding waiting", team.id, "account", account.status);
      return false;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!env.ALPACA_SOURCE_ACCOUNT_NO) {
    console.log("Funding waiting", team.id, "missing source account");
  } else try {
    const trading = await call(`/v1/trading/accounts/${accountId}/account`);
    if (Number(trading.cash) >= STARTING_CAPITAL) {
      console.log("Funding complete", team.id);
      await env.DB.prepare("UPDATE teams SET status = 'active' WHERE id = ?").bind(team.id).run();
      return true;
    }
    await call("/v1/instant_funding", {
      method: "POST",
      headers: { "Idempotency-Key": `competition-${team.id}-100000` },
      body: JSON.stringify({
        account_no: account.account_number,
        source_account_no: env.ALPACA_SOURCE_ACCOUNT_NO,
        amount: STARTING_CAPITAL.toFixed(2),
      }),
    });
    const funded = await call(`/v1/trading/accounts/${accountId}/account`);
    if (Number(funded.cash) >= STARTING_CAPITAL) {
      console.log("Funding complete", team.id);
      await env.DB.prepare("UPDATE teams SET status = 'active' WHERE id = ?").bind(team.id).run();
      return true;
    }
    console.log("Funding waiting", team.id, "instant funding", funded.cash);
    return false;
  } catch (err) {
    console.log("Instant funding unavailable", team.id, err.message, JSON.stringify(err.body || {}));
  }

  const relationships = await call(`/v1/accounts/${accountId}/ach_relationships`);
  let rel = relationships.find((r) => r.status === "APPROVED") || relationships[0];
  if (!rel) {
    rel = await call(`/v1/accounts/${accountId}/ach_relationships`, {
      method: "POST",
      body: JSON.stringify({
        account_owner_name: `Team ${team.id}`,
        bank_account_type: "CHECKING",
        bank_account_number: "32131231abc",
        bank_routing_number: "121000358",
        nickname: "Competition funding",
      }),
    });
  }
  if (rel.status !== "APPROVED") {
    console.log("Funding waiting", team.id, "relationship", rel.status);
    return false;
  }

  const transfers = await call(`/v1/accounts/${accountId}/transfers`);
  let transfer = transfers.find((t) => t.type === "ach" && t.direction === "INCOMING" && Number(t.amount) === STARTING_CAPITAL);
  if (!transfer) {
    transfer = await call(`/v1/accounts/${accountId}/transfers`, {
      method: "POST",
      body: JSON.stringify({
        transfer_type: "ach",
        relationship_id: rel.id,
        amount: String(STARTING_CAPITAL),
        direction: "INCOMING",
      }),
    });
  }
  if (!["COMPLETE", "SETTLED"].includes(transfer.status)) {
    const trading = await call(`/v1/trading/accounts/${accountId}/account`);
    if (Number(trading.cash) < STARTING_CAPITAL) {
      console.log("Funding waiting", team.id, "transfer", transfer.status, "cash", trading.cash);
      return false;
    }
  }

  console.log("Funding complete", team.id);
  await env.DB.prepare("UPDATE teams SET status = 'active' WHERE id = ?").bind(team.id).run();
  return true;
}

/* ---------- auth ---------- */

async function authAdmin(req, env) {
  const token = req.headers.get("X-Admin-Token") || "";
  return Boolean(env.COMPETITION_ADMIN_TOKEN && token && safeEqual(await sha256(token), await sha256(env.COMPETITION_ADMIN_TOKEN)));
}

async function authTeam(req, env, teamId) {
  const key = req.headers.get("X-Team-Key") || "";
  const team = await env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(teamId).first();
  if (!team || !key) return null;
  return safeEqual(await sha256(key), team.key_hash) ? team : null;
}

/* ---------- handlers ---------- */

async function register(req, env) {
  const state = await currentPhase(env);
  if (!state.registrationOpen) return fail(req, env, 403, "Registration is closed.");

  const body = await readJson(req);
  if (!body || body.website) return fail(req, env, 400, "Invalid request."); // honeypot field

  const name = String(body.teamName || "").trim();
  if (name.length < 3 || name.length > 40) return fail(req, env, 400, "Team name must be 3 to 40 characters.");

  const members = (Array.isArray(body.members) ? body.members : []).slice(0, MAX_MEMBERS).map((m) => ({
    name: String(m.name || "").trim().slice(0, 80),
    email: String(m.email || "").trim().toLowerCase().slice(0, 120),
  }));
  if (!members.length) return fail(req, env, 400, "Add at least one team member.");
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (members.some((m) => !m.name || !emailRe.test(m.email))) return fail(req, env, 400, "Each member needs a name and a valid email.");
  if (new Set(members.map((m) => m.email)).size !== members.length) return fail(req, env, 400, "Each member needs a different email.");

  const taken = await env.DB.prepare(
    `SELECT email FROM team_members WHERE lower(email) IN (${members.map(() => "?").join(",")})`
  ).bind(...members.map((m) => m.email)).first();
  if (taken) return fail(req, env, 409, `${taken.email} is already on a team.`);
  const dupName = await env.DB.prepare("SELECT 1 FROM teams WHERE name = ?").bind(name).first();
  if (dupName) return fail(req, env, 409, "That team name is taken.");

  const id = crypto.randomUUID().slice(0, 8);
  const key = newKey();
  const team = { id, alpaca_account_id: null };

  await env.DB.batch([
    env.DB.prepare("INSERT INTO teams (id, name, lead_email, key_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, name, members[0].email, await sha256(key), new Date().toISOString()),
    ...members.map((m, i) =>
      env.DB.prepare("INSERT INTO team_members (team_id, name, email, is_lead) VALUES (?, ?, ?, ?)").bind(id, m.name, m.email, i === 0 ? 1 : 0)
    ),
  ]);

  try {
    const funded = await finishProvisioning(env, team, req.headers.get("CF-Connecting-IP"));
    return reply(req, env, { teamId: id, teamKey: key, status: funded ? "active" : "pending_funding" }, 201);
  } catch (err) {
    console.error("Provisioning failed", err.message, JSON.stringify(err.body));
    const row = await env.DB.prepare("SELECT alpaca_account_id FROM teams WHERE id = ?").bind(id).first();
    if (row?.alpaca_account_id) {
      // Account exists, only funding failed: keep the team and let cron retry.
      return reply(req, env, { teamId: id, teamKey: key, status: "pending_funding" }, 201);
    }
    await env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(id).run();
    return fail(req, env, 502, "We couldn't create your portfolio. Try again in a minute.");
  }
}

async function adminListTeams(req, env) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.lead_email, t.status, t.alpaca_account_id, t.created_at,
            s.equity, s.cash
       FROM teams t
       LEFT JOIN equity_snapshots s ON s.team_id = t.id
        AND s.ts = (SELECT MAX(ts) FROM equity_snapshots WHERE team_id = t.id)
      ORDER BY t.created_at DESC`
  ).all();
  return reply(req, env, { teams: results });
}

async function adminFundTeam(req, env, teamId) {
  const body = await readJson(req);
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    return fail(req, env, 400, "Enter an amount from $0.01 to $1,000,000.");
  }
  const team = await env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(teamId).first();
  if (!team) return fail(req, env, 404, "Team not found.");
  if (!team.alpaca_account_id) return fail(req, env, 409, "This team does not have a portfolio account yet.");

  const relationships = await alpaca(env, `/v1/accounts/${team.alpaca_account_id}/ach_relationships`);
  const relationship = relationships.find((r) => r.status === "APPROVED") || relationships[0];
  if (!relationship || relationship.status !== "APPROVED") {
    return fail(req, env, 409, "The portfolio funding relationship is still being approved.");
  }
  await alpaca(env, `/v1/accounts/${team.alpaca_account_id}/transfers`, {
    method: "POST",
    body: JSON.stringify({
      transfer_type: "ach",
      relationship_id: relationship.id,
      amount: amount.toFixed(2),
      direction: "INCOMING",
    }),
  });
  return reply(req, env, { ok: true });
}

async function adminDeleteTeam(req, env, teamId) {
  await env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(teamId).run();
  return reply(req, env, { ok: true });
}

async function leaderboard(req, env) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, s.equity, s.last_equity, s.cash, s.ts
       FROM teams t
       JOIN equity_snapshots s ON s.team_id = t.id
        AND s.ts = (SELECT MAX(ts) FROM equity_snapshots WHERE team_id = t.id)
      WHERE t.status = 'active'`
  ).all();

  const rows = results
    .map((r) => ({
      teamId: r.id,
      team: r.name,
      equity: r.equity,
      cash: r.cash,
      dayChange: r.equity - r.last_equity,
      returnPct: ((r.equity - STARTING_CAPITAL) / STARTING_CAPITAL) * 100,
      updatedAt: r.ts,
    }))
    .sort((a, b) => b.returnPct - a.returnPct)
    .map((r, i) => ({ rank: i + 1, ...r }));

  const top = rows.slice(0, 5).map((r) => r.teamId);
  let history = [];
  if (top.length) {
    const q = await env.DB.prepare(
      `SELECT team_id, MAX(ts) AS ts, equity FROM equity_snapshots
        WHERE team_id IN (${top.map(() => "?").join(",")})
        GROUP BY team_id, strftime('%Y-%m-%d %H', ts) ORDER BY ts`
    ).bind(...top).all();
    history = q.results.map((h) => ({ teamId: h.team_id, ts: h.ts, returnPct: ((h.equity - STARTING_CAPITAL) / STARTING_CAPITAL) * 100 }));
  }

  return reply(req, env, { ...(await currentPhase(env)), teams: rows, history });
}

async function teamDetail(req, env, team) {
  const base = `/v1/trading/accounts/${team.alpaca_account_id}`;
  const [account, positions, orders, strategy, members] = await Promise.all([
    alpaca(env, `${base}/account`),
    alpaca(env, `${base}/positions`),
    alpaca(env, `${base}/orders?status=all&limit=50&direction=desc`),
    env.DB.prepare("SELECT body, submitted_at FROM strategy_submissions WHERE team_id = ?").bind(team.id).first(),
    env.DB.prepare("SELECT name, email, is_lead FROM team_members WHERE team_id = ?").bind(team.id).all(),
  ]);
  return reply(req, env, {
    ...(await currentPhase(env)),
    team: { id: team.id, name: team.name, status: team.status },
    members: members.results,
    account: {
      equity: account.equity,
      last_equity: account.last_equity,
      cash: account.cash,
      buying_power: account.buying_power,
      long_market_value: account.long_market_value,
    },
    positions: positions.map((p) => ({
      symbol: p.symbol, side: p.side, qty: p.qty, current_price: p.current_price,
      market_value: p.market_value, unrealized_pl: p.unrealized_pl, change_today: p.change_today,
    })),
    orders: orders.map((o) => ({
      symbol: o.symbol, side: o.side, type: o.type, qty: o.qty, filled_qty: o.filled_qty,
      status: o.status, submitted_at: o.submitted_at,
    })),
    strategy,
  });
}

async function placeOrder(req, env, team) {
  if (!(await currentPhase(env)).tradingOpen) return fail(req, env, 403, "Trading is not open.");
  if (team.status !== "active") return fail(req, env, 409, "Your portfolio isn't funded yet.");

  const b = await readJson(req);
  const symbol = String(b?.symbol || "").trim().toUpperCase();
  const side = b?.side;
  const type = b?.type || "market";
  const qty = Number(b?.qty);
  if (!SYMBOL_RE.test(symbol)) return fail(req, env, 400, "Enter a valid ticker symbol.");
  if (!["buy", "sell"].includes(side)) return fail(req, env, 400, "Side must be buy or sell.");
  if (!["market", "limit"].includes(type)) return fail(req, env, 400, "Order type must be market or limit.");
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) return fail(req, env, 400, "Quantity must be a whole number from 1 to 100,000.");
  const limit = Number(b?.limitPrice);
  if (type === "limit" && !(limit > 0)) return fail(req, env, 400, "Enter a limit price.");

  const base = `/v1/trading/accounts/${team.alpaca_account_id}`;

  if (side === "sell") {
    // Competition rule: no short selling. Sells can't exceed shares held.
    const positions = await alpaca(env, `${base}/positions`);
    const held = Number(positions.find((p) => p.symbol === symbol)?.qty || 0);
    if (qty > held) return fail(req, env, 400, `You hold ${held} shares of ${symbol}. Short selling isn't allowed.`);
  }

  try {
    const order = await alpaca(env, `${base}/orders`, {
      method: "POST",
      body: JSON.stringify({
        symbol, qty: String(qty), side, type, time_in_force: "day",
        ...(type === "limit" ? { limit_price: String(limit) } : {}),
      }),
    });
    return reply(req, env, { id: order.id, status: order.status }, 201);
  } catch (err) {
    const msg = err.body?.message || "Alpaca rejected the order.";
    return fail(req, env, err.status === 403 || err.status === 422 ? 400 : 502, msg);
  }
}

async function saveStrategy(req, env, team) {
  if (Date.now() > Date.parse(env.COMP_END)) return fail(req, env, 403, "The competition has ended.");
  const b = await readJson(req);
  const text = String(b?.body || "").trim();
  if (text.length < 50 || text.length > 4000) return fail(req, env, 400, "Write between 50 and 4,000 characters.");
  await env.DB.prepare(
    `INSERT INTO strategy_submissions (team_id, body, submitted_at) VALUES (?, ?, ?)
     ON CONFLICT(team_id) DO UPDATE SET body = excluded.body, submitted_at = excluded.submitted_at`
  ).bind(team.id, text, new Date().toISOString()).run();
  return reply(req, env, { ok: true });
}

/* ---------- router ---------- */

async function fetchHandler(req, env) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/v1/competition")) return fail(req, env, 404, "Not found.");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req, env) });

  const path = url.pathname.replace("/v1/competition", "") || "/";
  try {
    if (req.method === "GET" && path === "/config") return reply(req, env, await currentPhase(env));
    if (req.method === "GET" && path === "/leaderboard") return leaderboard(req, env);
    if (req.method === "POST" && path === "/register") return register(req, env);

    if (path.startsWith("/admin/")) {
      if (!(await authAdmin(req, env))) return fail(req, env, 401, "Competition admin token is missing or incorrect.");
      if (req.method === "GET" && path === "/admin/teams") return adminListTeams(req, env);
      if (path === "/admin/countdown") {
        if (req.method === "GET") return reply(req, env, await currentPhase(env));
        if (req.method === "PUT") return setCountdown(req, env);
        if (req.method === "DELETE") return clearCountdown(req, env);
      }
      const adminMatch = path.match(/^\/admin\/teams\/([a-z0-9-]+)(\/fund)?$/);
      if (adminMatch) {
        if (!adminMatch[2] && req.method === "DELETE") return adminDeleteTeam(req, env, adminMatch[1]);
        if (adminMatch[2] === "/fund" && req.method === "POST") {
          try {
            return await adminFundTeam(req, env, adminMatch[1]);
          } catch (err) {
            return fail(req, env, err.status === 422 || err.status === 409 ? 400 : 502, err.body?.message || "Alpaca rejected the funding transfer.");
          }
        }
      }
      return fail(req, env, 404, "Not found.");
    }

    const m = path.match(/^\/teams\/([a-z0-9-]+)(\/orders|\/strategy)?$/);
    if (m) {
      const team = await authTeam(req, env, m[1]);
      if (!team) return fail(req, env, 401, "Team passcode is missing or incorrect.");
      if (!m[2] && req.method === "GET") return teamDetail(req, env, team);
      if (m[2] === "/orders" && req.method === "POST") return placeOrder(req, env, team);
      if (m[2] === "/strategy" && req.method === "PUT") return saveStrategy(req, env, team);
    }
    return fail(req, env, 404, "Not found.");
  } catch (err) {
    console.error(err.message, JSON.stringify(err.body || {}));
    return fail(req, env, 500, "Something went wrong. Try again.");
  }
}

/* ---------- cron: retry funding, then snapshot equity ---------- */

async function scheduled(_evt, env) {
  alpacaToken = null;
  alpacaTokenExpiresAt = 0;
  const retry = await env.DB.prepare("SELECT * FROM teams WHERE status = 'pending_funding'").all();
  if (retry.results.length) console.log("Funding retries", retry.results.length);
  for (const team of retry.results) {
    try { await finishProvisioning(env, team, undefined, true); } catch (e) { console.error("Retry failed", team.id, e.message, JSON.stringify(e.body || {})); }
  }

  if (!(await currentPhase(env)).tradingOpen) return;
  const { results: teams } = await env.DB.prepare("SELECT id, alpaca_account_id FROM teams WHERE status = 'active'").all();
  const ts = new Date().toISOString();
  const stmts = [];
  // Workers cap subrequests per invocation (50 on the free plan); chunk or use a paid plan if teams > ~45.
  for (const t of teams) {
    try {
      const a = await alpaca(env, `/v1/trading/accounts/${t.alpaca_account_id}/account`, {}, true);
      stmts.push(
        env.DB.prepare("INSERT OR IGNORE INTO equity_snapshots (team_id, ts, equity, last_equity, cash) VALUES (?, ?, ?, ?, ?)")
          .bind(t.id, ts, Number(a.equity), Number(a.last_equity), Number(a.cash))
      );
    } catch (e) {
      console.error("Snapshot failed", t.id, e.message);
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
}

export default { fetch: fetchHandler, scheduled };
