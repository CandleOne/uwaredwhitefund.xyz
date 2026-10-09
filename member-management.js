const previewApiBaseUrl = new URLSearchParams(window.location.search).get("apiBaseUrl");
const localApiBaseUrl = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? `${window.location.protocol}//${window.location.hostname}:8789`
  : undefined;
const apiBaseUrl = (previewApiBaseUrl || localApiBaseUrl || document.querySelector('meta[name="alpaca-api-base"]')?.content).replace(/\/$/, "");
const form = document.querySelector("[data-create-member-form]");
const message = document.querySelector("[data-member-message]");
let csrfToken = "";

function showMessage(text, isError = false) {
  message.textContent = text;
  message.hidden = false;
  message.classList.toggle("is-error", isError);
}

async function initialize() {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/auth/status`, { credentials: "include" });
    const status = await response.json();
    if (!response.ok || !status.authenticated || status.user.role !== "manager") {
      window.location.replace("login.html");
      return;
    }
    csrfToken = status.csrf_token;
  } catch (error) {
    showMessage("The member service is unavailable.", true);
    console.error("Unable to initialize member management:", error);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(form);
  try {
    const response = await fetch(`${apiBaseUrl}/v1/members`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ email: values.get("email"), password: values.get("password") }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to create member account.");
    form.reset();
    showMessage("Member account created.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

initialize();
