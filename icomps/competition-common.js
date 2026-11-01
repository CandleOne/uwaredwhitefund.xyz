(() => {
  const params = new URLSearchParams(window.location.search);
  const local = ["127.0.0.1", "localhost"].includes(window.location.hostname)
    ? `${window.location.protocol}//${window.location.hostname}:8789`
    : undefined;
  const base = (params.get("apiBaseUrl") || local || document.querySelector('meta[name="alpaca-api-base"]')?.content || "").replace(/\/$/, "");

  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const valid = (v) => v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v));
  const money = (v) => (valid(v) ? usd.format(Number(v)) : "—");
  const signed = (v) => (valid(v) ? `${Number(v) > 0 ? "+" : ""}${usd.format(Number(v))}` : "—");
  const pct = (v) => (valid(v) ? `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}%` : "—");
  const tone = (v) => (Number(v) < 0 ? "is-negative" : Number(v) > 0 ? "is-positive" : "");

  async function api(path, { method = "GET", body, teamKey } = {}) {
    if (!base) throw new Error("The competition API URL has not been configured.");
    const res = await fetch(`${base}/v1/competition${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(teamKey ? { "X-Team-Key": teamKey } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  }

  function cell(row, text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    row.append(td);
    return td;
  }

  function emptyRow(tbody, cols, message) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = cols;
    td.textContent = message;
    tr.append(td);
    tbody.replaceChildren(tr);
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = !message;
  }

  const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  function phaseMessage(c) {
    switch (c.phase) {
      case "upcoming": return `Registration opens ${fmtDate(c.regOpen)}.`;
      case "registration": return `Registration is open until ${fmtDate(c.regClose)}. Trading starts ${fmtDate(c.compStart)}.`;
      case "waiting": return `Registration is closed. Trading starts ${fmtDate(c.compStart)}.`;
      case "live": return `Trading is live. The competition ends ${fmtDate(c.compEnd)}.`;
      default: return "The competition has ended. Final standings are below.";
    }
  }

  window.Competition = { api, cell, emptyRow, showError, money, signed, pct, tone, phaseMessage, fmtDate };
})();
