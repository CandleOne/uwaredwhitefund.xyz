const previewApiBaseUrl = new URLSearchParams(window.location.search).get("apiBaseUrl");
const localApiBaseUrl = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? `${window.location.protocol}//${window.location.hostname}:8789`
  : undefined;
const apiBaseUrl = (previewApiBaseUrl || localApiBaseUrl || document.querySelector('meta[name="alpaca-api-base"]')?.content).replace(/\/$/, "");
const form = document.querySelector("[data-auth-form]");
const heading = document.querySelector("[data-auth-heading]");
const message = document.querySelector("[data-auth-message]");
const submitButton = form.querySelector('button[type="submit"]');
let csrfToken = "";
let setupRequired = false;

function showMessage(text, isError = false) {
  message.textContent = text;
  message.hidden = false;
  message.classList.toggle("is-error", isError);
}

function renderMode() {
  heading.textContent = setupRequired ? "Create Manager Account" : "Member Sign In";
  submitButton.textContent = setupRequired ? "Create Manager Account" : "Login";
}

async function initialize() {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/auth/status`, { credentials: "include" });
    if (!response.ok) throw new Error(`Status request failed with ${response.status}.`);
    const status = await response.json();
    csrfToken = status.csrf_token;
    setupRequired = status.setup_required;
    renderMode();
    if (status.authenticated) showMessage(`Signed in as ${status.user.email}.`);
  } catch (error) {
    showMessage("The member service is unavailable.", true);
    console.error("Unable to initialize member sign-in:", error);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  try {
    const response = await fetch(`${apiBaseUrl}/v1/auth/${setupRequired ? "setup" : "login"}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") }),
    });
    const payload = await response.json();
    if (response.status === 409 && setupRequired) {
      setupRequired = false;
      renderMode();
      showMessage("A manager account has already been created. Sign in with your member credentials.");
      return;
    }
    if (!response.ok) throw new Error(payload.error || "Unable to sign in.");
    const dashboardUrl = previewApiBaseUrl ? `paperdashboard.html?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}` : "paperdashboard.html";
    window.location.assign(dashboardUrl);
  } catch (error) {
    showMessage(error.message, true);
  }
});

initialize();
