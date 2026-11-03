(() => {
  const C = window.Competition;
  const $ = (sel) => document.querySelector(sel);
  const errorEl = $("[data-error]");
  const phaseEl = $("[data-phase]");
  const signin = $("[data-signin]");
  const dash = $("[data-dashboard]");
  const orderForm = $("[data-order-form]");
  const strategyForm = $("[data-strategy-form]");
  const STARTING = 100000;

  let teamId = new URLSearchParams(location.search).get("team") || sessionStorage.getItem("cmp-last-team") || "";
  let teamKey = teamId ? sessionStorage.getItem(`cmp-key-${teamId}`) || "" : "";
  let timer = null;
  let strategyLoaded = false;
  let positions = [];
  let pendingOrder = null;

  function setMessage(el, text, isError) {
    el.textContent = text;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function heldShares(symbol) {
    const match = positions.find((p) => p.symbol === symbol);
    return match ? Number(match.qty) : 0;
  }

  function updateHeld() {
    const symbol = orderForm.elements.symbol.value.trim().toUpperCase();
    const readout = $("[data-held-readout]");
    if (!symbol) {
      readout.textContent = "";
    } else {
      const held = heldShares(symbol);
      readout.textContent = held ? `You hold ${held} shares of ${symbol}.` : `You hold no shares of ${symbol}.`;
    }
    orderForm.elements.qty.max = orderForm.elements.side.value === "sell" && symbol ? heldShares(symbol) : "";
  }

  function clearReview() {
    pendingOrder = null;
    $("[data-order-review-panel]").hidden = true;
  }

  function validateOrder() {
    const f = orderForm.elements;
    const symbol = f.symbol.value.trim().toUpperCase();
    const qty = Number(f.qty.value);
    const side = f.side.value;
    const type = f.type.value;
    const limitPrice = type === "limit" ? Number(f.limitPrice.value) : undefined;
    if (!/^[A-Z]{1,7}$/.test(symbol)) return { error: "Enter a valid ticker symbol." };
    if (!Number.isInteger(qty) || qty < 1) return { error: "Enter a whole number of shares, at least 1." };
    if (type === "limit" && !(limitPrice > 0)) return { error: "Enter a limit price greater than zero." };
    if (side === "sell" && qty > heldShares(symbol)) {
      return { error: `You only hold ${heldShares(symbol)} shares of ${symbol}, so you can't sell ${qty}.` };
    }
    return { order: { symbol, side, qty, type, limitPrice } };
  }

  function render(d) {
    $("[data-title]").textContent = d.team.name;
    const isActive = d.team.status === "active";
    phaseEl.textContent = isActive
      ? C.phaseMessage(d)
      : `Your portfolio is still being funded. The $${STARTING.toLocaleString()} competition allocation will appear once it finishes.`;

    const equity = Number(d.account.equity);
    const ret = ((equity - STARTING) / STARTING) * 100;
    const day = equity - Number(d.account.last_equity);
    $("[data-equity]").textContent = C.money(equity);
    $("[data-return]").textContent = C.pct(ret);
    $("[data-return]").className = C.tone(ret);
    $("[data-cash]").textContent = C.money(d.account.cash);
    $("[data-buying-power]").textContent = C.money(d.account.buying_power);
    $("[data-day-change]").textContent = C.signed(day);
    $("[data-day-change]").className = C.tone(day);

    const posBody = $("[data-positions]");
    if (!d.positions.length) C.emptyRow(posBody, 7, "No open positions yet. Place your first order above.");
    else posBody.replaceChildren(...d.positions.map((p) => {
      const tr = document.createElement("tr");
      C.cell(tr, p.symbol);
      C.cell(tr, p.side);
      C.cell(tr, p.qty);
      C.cell(tr, C.money(p.current_price));
      C.cell(tr, C.money(p.market_value));
      C.cell(tr, C.signed(p.unrealized_pl), C.tone(p.unrealized_pl));
      C.cell(tr, C.signed(p.change_today), C.tone(p.change_today));
      return tr;
    }));

    const ordBody = $("[data-orders]");
    if (!d.orders.length) C.emptyRow(ordBody, 7, "No orders yet.");
    else ordBody.replaceChildren(...d.orders.map((o) => {
      const tr = document.createElement("tr");
      C.cell(tr, o.symbol);
      C.cell(tr, o.side);
      C.cell(tr, o.type);
      C.cell(tr, o.qty);
      C.cell(tr, o.filled_qty);
      C.cell(tr, o.status);
      C.cell(tr, o.submitted_at ? new Date(o.submitted_at).toLocaleString() : "—");
      return tr;
    }));

    positions = d.positions;
    updateHeld();

    const canTrade = d.tradingOpen && d.team.status === "active";
    $("[data-order-review]").disabled = !canTrade;
    $("[data-order-confirm]").disabled = !canTrade;
    if (!canTrade) setMessage($("[data-order-message]"), "Trading isn't open yet.", false);

    if (!strategyLoaded) {
      strategyForm.elements.body.value = d.strategy?.body || "";
      strategyLoaded = true;
    }
  }

  async function refresh() {
    try {
      render(await C.api(`/teams/${encodeURIComponent(teamId)}`, { teamKey }));
      signin.hidden = true;
      C.showError(errorEl, "");
    } catch (err) {
      dash.hidden = true;
      if (err.status === 401) return showSignin("That team ID or passcode doesn't match. Check both and try again.");
      C.showError(errorEl, err.message);
    }
  }

  function showSignin(message) {
    clearInterval(timer);
    dash.hidden = true;
    signin.hidden = false;
    signin.elements.teamId.value = teamId;
    C.showError(errorEl, message || "");
  }

  function start() {
    signin.hidden = true;
    dash.hidden = false;
    strategyLoaded = false;
    refresh();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  }

  signin.addEventListener("submit", (e) => {
    e.preventDefault();
    teamId = signin.elements.teamId.value.trim().toLowerCase();
    teamKey = signin.elements.teamKey.value.trim();
    sessionStorage.setItem("cmp-last-team", teamId);
    sessionStorage.setItem(`cmp-key-${teamId}`, teamKey);
    start();
  });

  orderForm.elements.type.addEventListener("change", () => {
    $("[data-limit-wrap]").hidden = orderForm.elements.type.value !== "limit";
  });

  orderForm.elements.symbol.addEventListener("input", updateHeld);
  orderForm.elements.side.addEventListener("change", updateHeld);
  orderForm.addEventListener("input", clearReview);
  orderForm.addEventListener("change", clearReview);

  orderForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = $("[data-order-message]");
    const result = validateOrder();
    if (result.error) {
      clearReview();
      setMessage(msg, result.error, true);
      return;
    }
    pendingOrder = result.order;
    const o = pendingOrder;
    const priceText = o.type === "limit" ? ` at a limit of ${C.money(o.limitPrice)}` : " at market";
    $("[data-order-summary]").textContent = `Review: ${o.side} ${o.qty} shares of ${o.symbol}${priceText}. Day order.`;
    $("[data-order-review-panel]").hidden = false;
    setMessage(msg, "", false);
    $("[data-order-confirm]").focus();
  });

  $("[data-order-edit]").addEventListener("click", () => {
    clearReview();
    orderForm.elements.symbol.focus();
  });

  $("[data-order-confirm]").addEventListener("click", async () => {
    if (!pendingOrder) return;
    const msg = $("[data-order-message]");
    const confirmBtn = $("[data-order-confirm]");
    confirmBtn.disabled = true;
    setMessage(msg, "Submitting order…", false);
    try {
      const o = pendingOrder;
      await C.api(`/teams/${encodeURIComponent(teamId)}/orders`, {
        method: "POST",
        teamKey,
        body: { symbol: o.symbol, side: o.side, qty: o.qty, type: o.type, limitPrice: o.limitPrice },
      });
      setMessage(msg, `Order submitted: ${o.side} ${o.qty} ${o.symbol}.`, false);
      clearReview();
      orderForm.reset();
      $("[data-limit-wrap]").hidden = true;
      updateHeld();
      refresh();
    } catch (err) {
      setMessage(msg, err.message, true);
    } finally {
      confirmBtn.disabled = false;
    }
  });

  strategyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("[data-strategy-message]");
    try {
      await C.api(`/teams/${encodeURIComponent(teamId)}/strategy`, { method: "PUT", teamKey, body: { body: strategyForm.elements.body.value } });
      setMessage(msg, "Writeup saved.", false);
    } catch (err) {
      setMessage(msg, err.message, true);
    }
  });

  if (teamId && teamKey) start();
  else showSignin("");
})();
