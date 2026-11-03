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

  /* Full-screen launch countdown, controlled from the admin tool. Opens the page when it reaches zero. */
  function initCountdown() {
    if (!base) return;
    const style = document.createElement("style");
    style.textContent = `.cd-overlay{position:fixed;inset:0;z-index:9999;background:rgba(32,39,45,.97);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:system-ui,sans-serif}
.cd-overlay h2{margin:0 0 6px;font-size:clamp(1.6rem,4vw,2.6rem)}.cd-overlay p{margin:0 0 28px;opacity:.8}
.cd-grid{display:flex;gap:clamp(10px,3vw,28px)}.cd-unit{background:#ab1f2d;border-radius:10px;padding:16px 12px;min-width:clamp(64px,16vw,120px)}
.cd-unit b{display:block;font-size:clamp(2rem,7vw,4rem);font-variant-numeric:tabular-nums;line-height:1}.cd-unit span{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;opacity:.85}
.cd-target{margin-top:24px;font-size:.9rem;opacity:.7}`;
    document.head.append(style);
    let overlay = null, tick = null, endsAt = 0, offset = 0;

    function render() {
      const left = Math.max(0, endsAt - (Date.now() + offset));
      if (left === 0) { clearInterval(tick); tick = null; window.location.reload(); return; }
      const parts = [["Days", Math.floor(left / 864e5)], ["Hours", Math.floor(left / 36e5) % 24], ["Minutes", Math.floor(left / 6e4) % 60], ["Seconds", Math.floor(left / 1e3) % 60]];
      overlay.querySelector(".cd-grid").innerHTML = parts.map(([l, v]) => `<div class="cd-unit"><b>${String(v).padStart(2, "0")}</b><span>${l}</span></div>`).join("");
    }

    function show(target, serverNow) {
      const newEnd = Date.parse(target);
      offset = Date.parse(serverNow) - Date.now();
      endsAt = newEnd + 1000; // small grace so the server has crossed the target before reloading
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "cd-overlay";
        overlay.setAttribute("role", "alert");
        overlay.innerHTML = '<h2>The Red &amp; White Investment Competition opens in</h2><p>Check back when the timer reaches zero.</p><div class="cd-grid"></div><div class="cd-target"></div>';
        document.body.append(overlay);
        document.body.style.overflow = "hidden";
      }
      overlay.querySelector(".cd-target").textContent = `Opens ${new Date(newEnd).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}`;
      render();
      if (!tick) tick = setInterval(render, 1000);
    }

    function hide() {
      if (!overlay) return;
      clearInterval(tick); tick = null;
      overlay.remove(); overlay = null;
      document.body.style.overflow = "";
    }

    async function check() {
      try {
        const { countdown } = await api("/config");
        if (countdown?.active) show(countdown.target, countdown.now); else hide();
      } catch { /* leave the current state in place */ }
    }
    check();
    setInterval(check, 30000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initCountdown); else initCountdown();

  window.Competition = { api, cell, emptyRow, showError, money, signed, pct, tone, phaseMessage, fmtDate };
})();
