const previewApiBaseUrl = new URLSearchParams(window.location.search).get("apiBaseUrl");
const localApiBaseUrl = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? `${window.location.protocol}//${window.location.hostname}:8789`
  : undefined;
const apiBaseUrl = (previewApiBaseUrl || localApiBaseUrl || document.querySelector('meta[name="alpaca-api-base"]')?.content).replace(/\/$/, "");
const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const elements = {
  cash: document.querySelector("[data-widget-cash]"),
  cards: document.querySelector("[data-portfolio-cards]"),
  defaultClient: document.querySelector("[data-default-client-card]"),
  dayChange: document.querySelector("[data-widget-day-change]"),
  details: document.querySelector("[data-portfolio-details]"),
  error: document.querySelector("[data-dashboard-error]"),
  portfolioValue: document.querySelector("[data-widget-portfolio-value]"),
  unlinkShared: document.querySelector("[data-unlink-shared-portfolio]"),
  memberIdentity: document.querySelector("[data-member-identity]"),
  algorithmicResearch: document.querySelector("[data-algorithmic-research]"),
  liveTrading: document.querySelector("[data-live-trading]"),
  memberManagement: document.querySelector("[data-member-management]"),
  memberSettings: document.querySelector("[data-member-settings]"),
  memberSession: document.querySelector("[data-member-session]"),
  memberLogout: document.querySelector("[data-member-logout]"),
};
const portfolioStreams = new Map();
let defaultPortfolioStream;

function positionMemberSidebar() {
  const hero = document.querySelector(".paper-dashboard-hero");
  const main = hero?.closest("main");
  if (!hero || !main) return;
  hero.after(elements.memberSession);
  elements.memberSession.style.top = `${hero.getBoundingClientRect().bottom - main.getBoundingClientRect().top}px`;
}

function formatCurrency(value) {
  return value === null || value === undefined ? "—" : currencyFormatter.format(Number(value));
}

function setError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function connectWidgetStream() {
  if (!apiBaseUrl) {
    setError("The portfolio stream URL has not been configured.");
    return;
  }
  elements.details.href = `portfolio-data.html?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}`;
  document.querySelector("[data-link-portfolio]").href = `portfolio-link.html?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}`;
  defaultPortfolioStream = new EventSource(`${apiBaseUrl}/v1/dashboard/stream`);
  defaultPortfolioStream.onmessage = (event) => {
    try {
      const { account } = JSON.parse(event.data);
      const dayChange = Number(account.equity) - Number(account.last_equity);
      elements.portfolioValue.textContent = formatCurrency(account.portfolio_value);
      elements.cash.textContent = formatCurrency(account.cash);
      elements.dayChange.textContent = formatCurrency(dayChange);
      elements.dayChange.classList.toggle("is-negative", dayChange < 0);
      elements.dayChange.classList.toggle("is-positive", dayChange > 0);
      elements.error.hidden = true;
    } catch (error) {
      setError("The portfolio stream sent invalid data.");
      console.error("Unable to render portfolio widget data:", error);
    }
  };
  defaultPortfolioStream.onerror = () => {
    if (elements.defaultClient.isConnected) setError("The portfolio stream is unavailable. Retrying automatically.");
  };
  window.addEventListener("beforeunload", () => defaultPortfolioStream.close(), { once: true });
}

function createPortfolioCard(portfolio, csrfToken) {
  const container = document.createElement("article");
  container.className = "linked-portfolio-card";
  const card = document.createElement("a");
  card.className = "portfolio-summary-widget";
  card.href = `portfolio-data.html?portfolioId=${encodeURIComponent(portfolio.id)}&apiBaseUrl=${encodeURIComponent(apiBaseUrl)}`;
  const title = document.createElement("span");
  title.className = "portfolio-summary-widget-title";
  title.textContent = portfolio.label;
  const value = document.createElement("strong");
  const cash = document.createElement("strong");
  const dayChange = document.createElement("strong");
  for (const [label, output] of [["Value", value], ["Cash", cash], ["Day Change", dayChange]]) {
    const metric = document.createElement("span");
    metric.className = "portfolio-summary-widget-metric";
    const labelElement = document.createElement("span");
    labelElement.textContent = label;
    metric.append(labelElement, output);
    card.append(metric);
  }
  card.prepend(title);
  const stream = new EventSource(`${apiBaseUrl}/v1/portfolios/${encodeURIComponent(portfolio.id)}/stream`, { withCredentials: true });
  portfolioStreams.set(portfolio.id, stream);
  stream.onmessage = (event) => {
    try {
      const { account } = JSON.parse(event.data);
      const change = Number(account.equity) - Number(account.last_equity);
      value.textContent = formatCurrency(account.portfolio_value);
      cash.textContent = formatCurrency(account.cash);
      dayChange.textContent = formatCurrency(change);
      dayChange.classList.toggle("is-negative", change < 0);
      dayChange.classList.toggle("is-positive", change > 0);
    } catch (error) {
      console.error("Unable to render linked portfolio data:", error);
    }
  };
  window.addEventListener("beforeunload", () => stream.close(), { once: true });
  container.append(card);
  if (portfolio.is_owner) {
    const unlinkButton = document.createElement("button");
    unlinkButton.className = "unlink-portfolio-button";
    unlinkButton.type = "button";
    unlinkButton.textContent = "Unlink";
    unlinkButton.addEventListener("click", async () => {
      if (!window.confirm(`Unlink ${portfolio.label}? Its stored Alpaca credentials will be deleted.`)) return;
      try {
        const response = await fetch(`${apiBaseUrl}/v1/portfolios/${encodeURIComponent(portfolio.id)}`, {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRF-Token": csrfToken },
        });
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload.error || "Unable to unlink the portfolio.");
        }
        stream.close();
        portfolioStreams.delete(portfolio.id);
        container.remove();
      } catch (error) {
        setError(error.message);
        console.error("Unable to unlink portfolio:", error);
      }
    });
    container.append(unlinkButton);
  }
  return container;
}

async function loadLinkedPortfolios() {
  try {
    const statusResponse = await fetch(`${apiBaseUrl}/v1/auth/status`, { credentials: "include" });
    const status = await statusResponse.json();
    if (!status.default_portfolio_enabled) {
      defaultPortfolioStream.close();
      elements.defaultClient.remove();
      elements.error.hidden = true;
    }
    if (!statusResponse.ok || !status.authenticated) return;
    const response = await fetch(`${apiBaseUrl}/v1/portfolios`, { credentials: "include" });
    if (!response.ok) throw new Error(`Portfolio request failed with ${response.status}.`);
    const csrfToken = status.csrf_token;
    elements.memberIdentity.textContent = `Signed in as ${status.user.email}${status.user.role === "manager" ? " (Manager)" : ""}`;
    elements.memberSession.hidden = false;
    elements.memberSettings.hidden = false;
    elements.liveTrading.hidden = false;
    positionMemberSidebar();
    window.addEventListener("resize", positionMemberSidebar);
    document.body.classList.add("has-member-sidebar");
    elements.algorithmicResearch.hidden = false;
    elements.memberManagement.hidden = status.user.role !== "manager";
    elements.memberLogout.addEventListener("click", async () => {
      try {
        const logoutResponse = await fetch(`${apiBaseUrl}/v1/auth/logout`, {
          method: "POST",
          credentials: "include",
          headers: { "X-CSRF-Token": csrfToken },
        });
        if (!logoutResponse.ok) {
          const payload = await logoutResponse.json();
          throw new Error(payload.error || "Unable to sign out.");
        }
        window.location.reload();
      } catch (error) {
        setError(error.message);
        console.error("Unable to sign out:", error);
      }
    });
    if (status.default_portfolio_enabled && status.user.role === "manager") {
      elements.unlinkShared.hidden = false;
      elements.unlinkShared.addEventListener("click", async () => {
        if (!window.confirm("Unlink the shared Client portfolio for every user? This action cannot be undone.")) return;
        try {
          const deleteResponse = await fetch(`${apiBaseUrl}/v1/admin/default-portfolio`, {
            method: "DELETE",
            credentials: "include",
            headers: { "X-CSRF-Token": csrfToken },
          });
          if (!deleteResponse.ok) {
            const payload = await deleteResponse.json();
            throw new Error(payload.error || "Unable to unlink the shared Client portfolio.");
          }
          defaultPortfolioStream.close();
          elements.defaultClient.remove();
        } catch (error) {
          setError(error.message);
          console.error("Unable to unlink shared Client portfolio:", error);
        }
      });
    }
    const { portfolios } = await response.json();
    const linkCard = document.querySelector("[data-link-portfolio]");
    for (const portfolio of portfolios) elements.cards.insertBefore(createPortfolioCard(portfolio, csrfToken), linkCard);
  } catch (error) {
    console.error("Unable to load linked portfolios:", error);
  }
}

connectWidgetStream();
loadLinkedPortfolios();
