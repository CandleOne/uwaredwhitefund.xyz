const previewApiBaseUrl = new URLSearchParams(window.location.search).get("apiBaseUrl");
const portfolioId = new URLSearchParams(window.location.search).get("portfolioId");
const localApiBaseUrl = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? `${window.location.protocol}//${window.location.hostname}:8789`
  : undefined;
const apiBaseUrl = (previewApiBaseUrl || localApiBaseUrl || document.querySelector('meta[name="alpaca-api-base"]')?.content).replace(/\/$/, "");
const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const elements = {
  buyingPower: document.querySelector("[data-account-buying-power]"),
  cash: document.querySelector("[data-account-cash]"),
  dayChange: document.querySelector("[data-account-day-change]"),
  equity: document.querySelector("[data-account-equity]"),
  error: document.querySelector("[data-dashboard-error]"),
  longMarketValue: document.querySelector("[data-account-long-market-value]"),
  maintenanceMargin: document.querySelector("[data-account-maintenance-margin]"),
  orders: document.querySelector("[data-orders]"),
  portfolioValue: document.querySelector("[data-account-portfolio-value]"),
  positionCount: document.querySelector("[data-position-count]"),
  positions: document.querySelector("[data-positions]"),
  shortMarketValue: document.querySelector("[data-account-short-market-value]"),
  status: document.querySelector("[data-dashboard-status]"),
};

function formatCurrency(value) {
  return value === null || value === undefined ? "—" : currencyFormatter.format(Number(value));
}

function formatProfitLoss(value) {
  if (value === null || value === undefined) return "—";
  const amount = Number(value);
  return `${amount > 0 ? "+" : ""}${formatCurrency(amount)}`;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
}

function createCell(row, value, className) {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
}

function renderEmptyRow(container, columnCount, message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columnCount;
  cell.textContent = message;
  row.append(cell);
  container.replaceChildren(row);
}

function renderPositions(positions) {
  elements.positionCount.textContent = `${positions.length} open`;
  if (!positions.length) {
    renderEmptyRow(elements.positions, 7, "No open paper positions.");
    return;
  }
  const rows = positions.map((position) => {
    const row = document.createElement("tr");
    createCell(row, position.symbol);
    createCell(row, position.side);
    createCell(row, numberFormatter.format(Number(position.qty)));
    createCell(row, formatCurrency(position.current_price));
    createCell(row, formatCurrency(position.market_value));
    createCell(row, formatProfitLoss(position.unrealized_pl), Number(position.unrealized_pl) < 0 ? "is-negative" : "is-positive");
    createCell(row, formatProfitLoss(position.change_today), Number(position.change_today) < 0 ? "is-negative" : "is-positive");
    return row;
  });
  elements.positions.replaceChildren(...rows);
}

function renderOrders(orders) {
  if (!orders.length) {
    renderEmptyRow(elements.orders, 7, "No recent paper orders.");
    return;
  }
  const rows = orders.map((order) => {
    const row = document.createElement("tr");
    createCell(row, order.symbol);
    createCell(row, order.side);
    createCell(row, order.type);
    createCell(row, numberFormatter.format(Number(order.qty)));
    createCell(row, numberFormatter.format(Number(order.filled_qty)));
    createCell(row, order.status);
    createCell(row, order.submitted_at ? new Date(order.submitted_at).toLocaleString() : "—");
    return row;
  });
  elements.orders.replaceChildren(...rows);
}

function renderDashboard({ account, orders, positions }) {
  const dayChange = Number(account.equity) - Number(account.last_equity);
  elements.equity.textContent = formatCurrency(account.equity);
  elements.portfolioValue.textContent = formatCurrency(account.portfolio_value);
  elements.cash.textContent = formatCurrency(account.cash);
  elements.buyingPower.textContent = formatCurrency(account.buying_power);
  elements.longMarketValue.textContent = formatCurrency(account.long_market_value);
  elements.shortMarketValue.textContent = formatCurrency(account.short_market_value);
  elements.maintenanceMargin.textContent = formatCurrency(account.maintenance_margin);
  elements.dayChange.textContent = formatProfitLoss(dayChange);
  elements.dayChange.classList.toggle("is-negative", dayChange < 0);
  elements.dayChange.classList.toggle("is-positive", dayChange > 0);
  renderPositions(positions);
  renderOrders(orders);
}

function connectDashboardStream() {
  if (!apiBaseUrl) {
    elements.error.textContent = "The portfolio stream URL has not been configured.";
    elements.error.hidden = false;
    setStatus("Configuration required", true);
    return;
  }
  const streamPath = portfolioId ? `/v1/portfolios/${encodeURIComponent(portfolioId)}/stream` : "/v1/dashboard/stream";
  const stream = new EventSource(`${apiBaseUrl}${streamPath}`, { withCredentials: Boolean(portfolioId) });
  stream.onopen = () => {
    elements.error.hidden = true;
    setStatus("Connected");
  };
  stream.onmessage = (event) => {
    try {
      renderDashboard(JSON.parse(event.data));
      elements.error.hidden = true;
      setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      elements.error.textContent = "The portfolio stream sent invalid data.";
      elements.error.hidden = false;
      setStatus("Data error", true);
      console.error("Unable to render paper dashboard data:", error);
    }
  };
  stream.onerror = () => {
    elements.error.textContent = "The paper account stream is unavailable. Retrying automatically.";
    elements.error.hidden = false;
    setStatus("Reconnecting", true);
  };
  window.addEventListener("beforeunload", () => stream.close(), { once: true });
}

connectDashboardStream();
