const previewApiBaseUrl = new URLSearchParams(window.location.search).get("apiBaseUrl");
const localApiBaseUrl = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? `${window.location.protocol}//${window.location.hostname}:8789`
  : undefined;
const apiBaseUrl = (
  previewApiBaseUrl ||
  localApiBaseUrl ||
  document.querySelector('meta[name="alpaca-api-base"]')?.content ||
  ""
).replace(/\/$/, "");
const libraryGrid = document.querySelector("#libraryGrid");
const libraryStatus = document.querySelector("[data-event-library-status]");

function createEventCard(event) {
  const card = document.createElement("article");
  card.className = "poster-card";

  const imageWrapper = document.createElement("div");
  imageWrapper.className = "poster-img-wrapper";

  if (event.badge) {
    const badge = document.createElement("span");
    badge.className = "poster-badge";
    badge.textContent = event.badge;
    imageWrapper.append(badge);
  }

  const image = document.createElement("img");
  image.className = "poster-img";
  image.src = event.image_url;
  image.alt = "";
  image.loading = "lazy";
  imageWrapper.append(image);

  if (event.link_label && event.link_url) {
    const linkContainer = document.createElement("span");
    linkContainer.className = "poster-aux";
    const link = document.createElement("a");
    link.href = event.link_url;
    link.textContent = event.link_label;
    linkContainer.append(link);
    imageWrapper.append(linkContainer);
  }

  const info = document.createElement("div");
  info.className = "poster-info";

  const title = document.createElement("p");
  title.className = "poster-title";
  title.textContent = event.title;
  info.append(title);

  const details = document.createElement("p");
  details.className = "poster-meta";
  details.textContent = event.details;
  info.append(details);

  card.append(imageWrapper, info);
  return card;
}

async function loadEvents() {
  if (!apiBaseUrl) {
    throw new Error("The event service URL has not been configured.");
  }

  const response = await fetch(`${apiBaseUrl}/v1/events`, { credentials: "include" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Unable to load events.");
  }
  if (!Array.isArray(payload.events)) {
    throw new Error("The event service returned an invalid event list.");
  }

  libraryGrid.replaceChildren();
  if (payload.events.length === 0) {
    libraryStatus.textContent = "There are no events to display right now.";
    libraryGrid.append(libraryStatus);
    return;
  }

  libraryStatus.remove();
  payload.events.forEach((event) => libraryGrid.append(createEventCard(event)));
}

loadEvents().catch((error) => {
  libraryStatus.textContent = "Events are temporarily unavailable. Please try again later.";
  console.error("Unable to load the event library:", error);
});
