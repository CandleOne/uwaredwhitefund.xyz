const previewApiBaseUrl = new URLSearchParams(window.location.search).get("apiBaseUrl");
const localApiBaseUrl = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? `${window.location.protocol}//${window.location.hostname}:8789`
  : undefined;
const apiBaseUrl = (previewApiBaseUrl || localApiBaseUrl || document.querySelector('meta[name="alpaca-api-base"]')?.content).replace(/\/$/, "");
const form = document.querySelector("[data-create-member-form]");
const message = document.querySelector("[data-member-message]");
const eventForm = document.querySelector("[data-create-event-form]");
const eventMessage = document.querySelector("[data-event-message]");
const eventList = document.querySelector("[data-event-list]");
const eventListStatus = document.querySelector("[data-event-list-status]");
let csrfToken = "";

function showMessage(text, isError = false) {
  message.textContent = text;
  message.hidden = false;
  message.classList.toggle("is-error", isError);
}

function showEventMessage(text, isError = false) {
  eventMessage.textContent = text;
  eventMessage.hidden = false;
  eventMessage.classList.toggle("is-error", isError);
}

function renderEventList(events) {
  eventList.replaceChildren();
  eventListStatus.hidden = events.length > 0;
  eventListStatus.textContent = events.length ? "" : "There are no events in the library.";

  events.forEach((event) => {
    const item = document.createElement("li");
    item.className = "event-admin-item";
    item.dataset.eventId = event.id;

    const description = document.createElement("div");
    const title = document.createElement("p");
    title.className = "event-admin-item-title";
    title.textContent = event.title;
    description.append(title);

    const details = document.createElement("p");
    details.className = "event-admin-item-details";
    details.textContent = event.details;
    description.append(details);

    const removeButton = document.createElement("button");
    removeButton.className = "event-admin-remove";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.dataset.removeEventId = event.id;

    item.append(description, removeButton);
    eventList.append(item);
  });
}

async function loadEvents() {
  const response = await fetch(`${apiBaseUrl}/v1/events`, { credentials: "include" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Unable to load events.");
  if (!Array.isArray(payload.events)) throw new Error("The event service returned an invalid event list.");
  renderEventList(payload.events);
}

async function initialize() {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/auth/status`, { credentials: "include" });
    const status = await response.json();
    if (!response.ok || !status.authenticated || status.user.role !== "manager") {
      window.location.replace("login.html");
      return;
    }
    if (typeof status.csrf_token !== "string" || !status.csrf_token) {
      throw new Error("The member service did not return a CSRF token.");
    }
    csrfToken = status.csrf_token;
    await loadEvents();
  } catch (error) {
    if (eventListStatus) {
      eventListStatus.hidden = false;
      eventListStatus.textContent = "Unable to load events. Please reload the page to try again.";
    }
    showMessage(error.message || "The member service is unavailable.", true);
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

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(eventForm);
  const payload = Object.fromEntries(
    ["title", "details", "image_url", "badge", "link_label", "link_url"].map((field) => [
      field,
      values.get(field),
    ]),
  );
  try {
    const response = await fetch(`${apiBaseUrl}/v1/events`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to add event.");
    eventForm.reset();
    showEventMessage("Event added to the library.");
    await loadEvents();
  } catch (error) {
    showEventMessage(error.message, true);
  }
});

eventList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-event-id]");
  if (!button) return;
  const eventId = button.dataset.removeEventId;
  if (!window.confirm("Remove this event from the public library?")) return;

  button.disabled = true;
  try {
    const response = await fetch(`${apiBaseUrl}/v1/events/${eventId}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "X-CSRF-Token": csrfToken },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to remove event.");
    showEventMessage("Event removed from the library.");
    await loadEvents();
  } catch (error) {
    button.disabled = false;
    showEventMessage(error.message, true);
  }
});
