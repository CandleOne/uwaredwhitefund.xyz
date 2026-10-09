const previewApiBaseUrl = new URLSearchParams(window.location.search).get("apiBaseUrl");
const localApiBaseUrl = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? `${window.location.protocol}//${window.location.hostname}:8789`
  : undefined;
const apiBaseUrl = (previewApiBaseUrl || localApiBaseUrl || document.querySelector('meta[name="alpaca-api-base"]')?.content).replace(/\/$/, "");
const elements = {
  message: document.querySelector("[data-settings-message]"),
  summary: document.querySelector("[data-owned-portfolio-summary]"),
  unlinkAll: document.querySelector("[data-unlink-all-portfolios]"),
};
let csrfToken = "";
let ownedCount = 0;

function showMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.hidden = false;
  elements.message.classList.toggle("is-error", isError);
}

function dashboardUrl() {
  return previewApiBaseUrl ? `paperdashboard.html?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}` : "paperdashboard.html";
}

async function initialize() {
  try {
    const statusResponse = await fetch(`${apiBaseUrl}/v1/auth/status`, { credentials: "include" });
    const status = await statusResponse.json();
    if (!statusResponse.ok || !status.authenticated) {
      window.location.replace(previewApiBaseUrl ? `login.html?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}` : "login.html");
      return;
    }
    csrfToken = status.csrf_token;
    const portfoliosResponse = await fetch(`${apiBaseUrl}/v1/portfolios`, { credentials: "include" });
    if (!portfoliosResponse.ok) throw new Error("Unable to load linked portfolios.");
    const { portfolios } = await portfoliosResponse.json();
    ownedCount = portfolios.filter((portfolio) => portfolio.is_owner).length;
    elements.summary.textContent = ownedCount
      ? `${ownedCount} portfolio connection${ownedCount === 1 ? "" : "s"} linked to your account.`
      : "No portfolio connections are linked to your account.";
    elements.unlinkAll.hidden = ownedCount === 0;
  } catch (error) {
    showMessage(error.message || "The member service is unavailable.", true);
    console.error("Unable to initialize settings:", error);
  }
}

elements.unlinkAll.addEventListener("click", async () => {
  if (!window.confirm(`Unlink all ${ownedCount} of your portfolio connections? Their stored Alpaca credentials will be deleted.`)) return;
  try {
    const response = await fetch(`${apiBaseUrl}/v1/portfolios`, {
      method: "DELETE",
      credentials: "include",
      headers: { "X-CSRF-Token": csrfToken },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to unlink portfolios.");
    window.location.assign(dashboardUrl());
  } catch (error) {
    showMessage(error.message, true);
  }
});

initialize();
