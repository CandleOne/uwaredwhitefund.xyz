(() => {
  const C = window.Competition;
  const board = document.querySelector("[data-board]");
  const errorEl = document.querySelector("[data-error]");
  const phaseEl = document.querySelector("[data-phase]");
  const chartWrap = document.querySelector("[data-chart-wrap]");
  const chart = document.querySelector("[data-chart]");
  const legend = document.querySelector("[data-legend]");
  const COLORS = ["#8c1d2f", "#1f5f8b", "#2e7d4f", "#b8860b", "#5b4a8a"];
  const NS = "http://www.w3.org/2000/svg";

  function svg(tag, attrs, text) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function renderBoard(teams) {
    if (!teams.length) {
      C.emptyRow(board, 5, "No teams have standings yet. Check back once trading starts.");
      return;
    }
    const rows = teams.map((t) => {
      const tr = document.createElement("tr");
      C.cell(tr, String(t.rank));
      C.cell(tr, t.status === "pending_funding" ? `${t.team} (funding)` : t.team);
      C.cell(tr, C.pct(t.returnPct), C.tone(t.returnPct));
      C.cell(tr, C.money(t.equity));
      C.cell(tr, C.signed(t.dayChange), C.tone(t.dayChange));
      return tr;
    });
    board.replaceChildren(...rows);
  }

  function renderChart(teams, history) {
    const top = teams.slice(0, 5);
    const points = history.filter((h) => top.some((t) => t.teamId === h.teamId));
    if (points.length < 2) {
      chartWrap.hidden = true;
      return;
    }
    chartWrap.hidden = false;
    const W = 800, H = 320, L = 56, R = 16, T = 12, B = 28;
    const times = points.map((p) => Date.parse(p.ts));
    const x0 = Math.min(...times), x1 = Math.max(...times);
    const vals = points.map((p) => p.returnPct).concat(0);
    let y0 = Math.min(...vals), y1 = Math.max(...vals);
    if (y1 - y0 < 0.5) { y0 -= 0.25; y1 += 0.25; }
    const x = (t) => L + ((t - x0) / Math.max(1, x1 - x0)) * (W - L - R);
    const y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);

    const nodes = [];
    for (let i = 0; i <= 4; i++) {
      const v = y0 + ((y1 - y0) * i) / 4;
      nodes.push(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "#c8cdca", "stroke-width": v === 0 ? 1.5 : 0.5 }));
      nodes.push(svg("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", "font-size": 12, fill: "#555" }, `${v.toFixed(1)}%`));
    }
    for (const t of [x0, x1]) {
      nodes.push(svg("text", { x: x(t), y: H - 8, "text-anchor": t === x0 ? "start" : "end", "font-size": 12, fill: "#555" },
        new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })));
    }
    const items = [];
    top.forEach((team, i) => {
      const line = points.filter((p) => p.teamId === team.teamId).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      if (!line.length) return;
      const d = line.map((p, j) => `${j ? "L" : "M"}${x(Date.parse(p.ts)).toFixed(1)},${y(p.returnPct).toFixed(1)}`).join(" ");
      nodes.push(svg("path", { d, fill: "none", stroke: COLORS[i], "stroke-width": 2.5, "stroke-linejoin": "round" }));
      const li = document.createElement("li");
      const swatch = document.createElement("i");
      swatch.style.background = COLORS[i];
      li.append(swatch, document.createTextNode(team.team));
      items.push(li);
    });
    chart.replaceChildren(...nodes);
    legend.replaceChildren(...items);
  }

  async function load() {
    try {
      const data = await C.api("/leaderboard");
      phaseEl.textContent = C.phaseMessage(data);
      renderBoard(data.teams);
      renderChart(data.teams, data.history);
      C.showError(errorEl, "");
    } catch (err) {
      C.showError(errorEl, err.message);
    }
  }

  load();
  setInterval(() => { if (!document.hidden) load(); }, 60000);
})();
