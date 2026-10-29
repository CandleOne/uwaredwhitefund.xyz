const previewApiBaseUrl = new URLSearchParams(window.location.search).get("apiBaseUrl");
const localApiBaseUrl = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? `${window.location.protocol}//${window.location.hostname}:8789`
  : undefined;
const apiBaseUrl = (previewApiBaseUrl || localApiBaseUrl || document.querySelector('meta[name="alpaca-api-base"]')?.content || "").replace(/\/$/, "");
const form = document.querySelector("[data-application-form]");
const message = document.querySelector("[data-application-message]");
const submitButton = form.querySelector('button[type="submit"]');
let csrfToken = "";

function showMessage(text, isError = false) {
  message.textContent = text;
  message.hidden = false;
  message.classList.toggle("is-error", isError);
}

async function initialize() {
  try {
    if (!apiBaseUrl) throw new Error("The application service URL has not been configured.");
    const response = await fetch(`${apiBaseUrl}/v1/auth/status`, { credentials: "include" });
    const status = await response.json();
    if (!response.ok || typeof status.csrf_token !== "string" || !status.csrf_token) {
      throw new Error("The application service is unavailable.");
    }
    csrfToken = status.csrf_token;
    submitButton.disabled = false;
  } catch (error) {
    submitButton.disabled = true;
    showMessage(error.message, true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  showMessage("Submitting your application…");
  const values = {};
  for (const [name, value] of new FormData(form).entries()) {
    values[name] = values[name] ? `${values[name]}, ${value}` : value;
  }
  try {
    const response = await fetch(`${apiBaseUrl}/v1/applications`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(values),
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "Unable to submit your application.");
    }
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const download = document.createElement("a");
    download.href = downloadUrl;
    download.download = "red-white-fund-application.csv";
    download.click();
    URL.revokeObjectURL(downloadUrl);
    form.reset();
    window.location.assign("application-confirmation.html");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

initialize();
