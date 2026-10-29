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
const posterSelect = document.querySelector("#event-image");
const posterPreview = document.querySelector("[data-event-poster-preview]");
const addEventButton = eventForm.querySelector('button[type="submit"]');
const eventLinkSelect = document.querySelector("#event-link-url");
const customLinkField = document.querySelector("[data-custom-link-field]");
const customLinkInput = document.querySelector("#event-custom-link");
const adminTabs = [...document.querySelectorAll("[data-admin-tab]")];
const adminPanels = [...document.querySelectorAll("[data-admin-panel]")];
const applicationList = document.querySelector("[data-application-list]");
const applicationListStatus = document.querySelector("[data-application-list-status]");
let csrfToken = "";

function selectAdminTab(tabName, moveFocus = false) {
  adminTabs.forEach((tab) => {
    const isSelected = tab.dataset.adminTab === tabName;
    tab.classList.toggle("is-active", isSelected);
    tab.setAttribute("aria-selected", String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
    if (isSelected && moveFocus) tab.focus();
  });
  adminPanels.forEach((panel) => {
    const isSelected = panel.dataset.adminPanel === tabName;
    panel.classList.toggle("is-active", isSelected);
    panel.hidden = !isSelected;
  });
}

adminTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectAdminTab(tab.dataset.adminTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? adminTabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + adminTabs.length) % adminTabs.length;
    selectAdminTab(adminTabs[nextIndex].dataset.adminTab, true);
  });
});

document.querySelectorAll("[data-admin-tab-target]").forEach((button) => {
  button.addEventListener("click", () => selectAdminTab(button.dataset.adminTabTarget));
});

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

async function loadPosterOptions() {
  addEventButton.disabled = true;
  const response = await fetch(`${apiBaseUrl}/v1/event-posters`, { credentials: "include" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Unable to load event poster images.");
  if (!Array.isArray(payload.posters)) throw new Error("The event service returned an invalid poster list.");

  posterSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = payload.posters.length
    ? "Choose a poster image"
    : "No images found in assets/eventposters";
  placeholder.disabled = true;
  placeholder.selected = true;
  posterSelect.append(placeholder);

  payload.posters.forEach((poster) => {
    const option = document.createElement("option");
    option.value = poster.url;
    option.textContent = poster.name;
    posterSelect.append(option);
  });
  posterSelect.disabled = payload.posters.length === 0;
  posterSelect.required = payload.posters.length > 0;
  addEventButton.disabled = payload.posters.length === 0;
}

function renderApplicationList(applications) {
  applicationList.replaceChildren();
  applicationListStatus.hidden = applications.length > 0;
  applicationListStatus.textContent = applications.length
    ? ""
    : "No online applications have been submitted.";
  applications.forEach((application) => {
    const item = document.createElement("li");
    item.className = "event-admin-item";
    const description = document.createElement("div");
    const name = document.createElement("p");
    name.className = "event-admin-item-title";
    name.textContent = application.applicant_name;
    const details = document.createElement("p");
    details.className = "event-admin-item-details";
    details.textContent = `${application.applicant_email} · Submitted ${application.submitted_at}`;
    description.append(name, details);
    const downloadButton = document.createElement("button");
    downloadButton.className = "event-admin-remove";
    downloadButton.type = "button";
    downloadButton.textContent = "Download CSV";
    downloadButton.dataset.downloadApplicationId = application.id;
    item.append(description, downloadButton);
    applicationList.append(item);
  });
}

async function loadApplications() {
  const response = await fetch(`${apiBaseUrl}/v1/applications`, { credentials: "include" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Unable to load applications.");
  if (!Array.isArray(payload.applications)) throw new Error("The application service returned an invalid application list.");
  renderApplicationList(payload.applications);
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
    const [eventsResult, postersResult, applicationsResult] = await Promise.allSettled([
      loadEvents(),
      loadPosterOptions(),
      loadApplications(),
    ]);
    if (eventsResult.status === "rejected") {
      eventListStatus.hidden = false;
      eventListStatus.textContent = "Unable to load events. Please reload the page to try again.";
      console.error("Unable to load events:", eventsResult.reason);
    }
    if (postersResult.status === "rejected") {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Unable to load poster images";
      posterSelect.replaceChildren(option);
      posterSelect.disabled = true;
      addEventButton.disabled = true;
      showEventMessage("Unable to load poster images. Please reload the page to try again.", true);
      console.error("Unable to load event poster images:", postersResult.reason);
    }
    if (applicationsResult.status === "rejected") {
      applicationListStatus.hidden = false;
      applicationListStatus.textContent = "Unable to load applications. Please reload the page to try again.";
      console.error("Unable to load applications:", applicationsResult.reason);
    }
  } catch (error) {
    if (eventListStatus) {
      eventListStatus.hidden = false;
      eventListStatus.textContent = "Unable to load events. Please reload the page to try again.";
    }
    if (posterSelect) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Unable to load poster images";
      posterSelect.replaceChildren(option);
      posterSelect.disabled = true;
      addEventButton.disabled = true;
    }
    if (applicationListStatus) {
      applicationListStatus.hidden = false;
      applicationListStatus.textContent = "Unable to load applications. Please reload the page to try again.";
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
  const selectedLink = values.get("link_url");
  const payload = Object.fromEntries(
    ["title", "details", "image_url", "badge", "link_label"].map((field) => [
      field,
      values.get(field),
    ]),
  );
  payload.link_url = selectedLink === "custom" ? values.get("custom_link_url") : selectedLink;
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
    customLinkField.hidden = true;
    customLinkInput.required = false;
    posterPreview.hidden = true;
    posterPreview.removeAttribute("src");
    showEventMessage("Event added to the library.");
    await loadEvents();
  } catch (error) {
    showEventMessage(error.message, true);
  }
});

eventLinkSelect.addEventListener("change", () => {
  const isCustomLink = eventLinkSelect.value === "custom";
  customLinkField.hidden = !isCustomLink;
  customLinkInput.required = isCustomLink;
  if (!isCustomLink) customLinkInput.value = "";
});

posterSelect.addEventListener("change", () => {
  const hasSelection = Boolean(posterSelect.value);
  posterPreview.hidden = !hasSelection;
  if (hasSelection) posterPreview.src = posterSelect.value;
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

    applicationList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-download-application-id]");
      if (!button) return;
      button.disabled = true;
      try {
        const response = await fetch(`${apiBaseUrl}/v1/applications/${button.dataset.downloadApplicationId}`, {
          credentials: "include",
        });
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || "Unable to download application.");
        }
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const download = document.createElement("a");
        download.href = downloadUrl;
        download.download = `application-${button.dataset.downloadApplicationId}.csv`;
        download.click();
        URL.revokeObjectURL(downloadUrl);
      } catch (error) {
        applicationListStatus.hidden = false;
        applicationListStatus.textContent = error.message;
      } finally {
        button.disabled = false;
      }
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
