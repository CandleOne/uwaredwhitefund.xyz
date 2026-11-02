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

const calendarRoot = document.querySelector("[data-event-calendar]");
const calendarGrid = document.querySelector("[data-calendar-grid]");
const calendarTitle = document.querySelector("[data-calendar-title]");
const calendarDayEvents = document.querySelector("[data-calendar-day-events]");
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const today = new Date();
let calendarYear = today.getFullYear();
let calendarMonth = today.getMonth();
let selectedDate = null;
let eventsByDate = new Map();

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function renderDayEvents() {
  calendarDayEvents.replaceChildren();
  if (!selectedDate) return;
  const [year, month, day] = selectedDate.split("-").map(Number);
  const heading = document.createElement("h4");
  heading.textContent = new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  calendarDayEvents.append(heading);

  const dayEvents = eventsByDate.get(selectedDate) || [];
  if (dayEvents.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No events scheduled for this day.";
    calendarDayEvents.append(empty);
    return;
  }
  dayEvents.forEach((event) => {
    const item = document.createElement("div");
    item.className = "calendar-event-detail";
    const name = document.createElement("strong");
    name.textContent = event.title;
    const details = document.createElement("span");
    details.textContent = event.details;
    item.append(name, details);
    if (event.link_label && event.link_url) {
      const link = document.createElement("a");
      link.href = event.link_url;
      link.textContent = event.link_label;
      item.append(link);
    }
    calendarDayEvents.append(item);
  });
}

function drawCalendar() {
  if (!calendarRoot) return;
  calendarTitle.textContent = new Date(calendarYear, calendarMonth, 1).toLocaleDateString(undefined, {
    month: "long", year: "numeric",
  });
  calendarGrid.replaceChildren();
  weekdayNames.forEach((name) => {
    const cell = document.createElement("div");
    cell.className = "calendar-weekday";
    cell.setAttribute("role", "columnheader");
    cell.textContent = name;
    calendarGrid.append(cell);
  });

  const firstWeekday = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  for (let i = 0; i < firstWeekday; i += 1) {
    const blank = document.createElement("div");
    blank.className = "calendar-cell is-empty";
    calendarGrid.append(blank);
  }
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKey(calendarYear, calendarMonth, day);
    const dayEvents = eventsByDate.get(key) || [];
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-cell";
    cell.classList.toggle("is-today", key === todayKey);
    cell.classList.toggle("is-selected", key === selectedDate);
    cell.classList.toggle("has-events", dayEvents.length > 0);
    const number = document.createElement("span");
    number.className = "calendar-day-number";
    number.textContent = day;
    cell.append(number);
    dayEvents.slice(0, 2).forEach((event) => {
      const chip = document.createElement("span");
      chip.className = "calendar-chip";
      chip.textContent = event.title;
      cell.append(chip);
    });
    if (dayEvents.length > 2) {
      const more = document.createElement("span");
      more.className = "calendar-more";
      more.textContent = `+${dayEvents.length - 2} more`;
      cell.append(more);
    }
    cell.setAttribute("aria-label", `${key}, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`);
    cell.addEventListener("click", () => {
      selectedDate = key;
      drawCalendar();
    });
    calendarGrid.append(cell);
  }
  renderDayEvents();
}

function renderCalendar(events) {
  if (!calendarRoot) return;
  eventsByDate = new Map();
  events.filter((event) => event.event_date).forEach((event) => {
    if (!eventsByDate.has(event.event_date)) eventsByDate.set(event.event_date, []);
    eventsByDate.get(event.event_date).push(event);
  });
  // Open on the nearest upcoming month that has events, if the current month is empty.
  const currentPrefix = dateKey(calendarYear, calendarMonth, 1).slice(0, 7);
  const dates = [...eventsByDate.keys()].sort();
  if (!dates.some((date) => date.startsWith(currentPrefix))) {
    const upcoming = dates.find((date) => date >= dateKey(today.getFullYear(), today.getMonth(), today.getDate()));
    if (upcoming) {
      const [year, month] = upcoming.split("-").map(Number);
      calendarYear = year;
      calendarMonth = month - 1;
    }
  }
  drawCalendar();
}

function shiftMonth(delta) {
  const next = new Date(calendarYear, calendarMonth + delta, 1);
  calendarYear = next.getFullYear();
  calendarMonth = next.getMonth();
  selectedDate = null;
  drawCalendar();
}

document.querySelector("[data-calendar-prev]")?.addEventListener("click", () => shiftMonth(-1));
document.querySelector("[data-calendar-next]")?.addEventListener("click", () => shiftMonth(1));
document.querySelector("[data-calendar-today]")?.addEventListener("click", () => {
  calendarYear = today.getFullYear();
  calendarMonth = today.getMonth();
  selectedDate = null;
  drawCalendar();
});
const calendarSection = document.querySelector("#calendar");
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-calendar-toggle]")) {
    calendarSection.hidden = true;
    return;
  }
  const open = event.target.closest('a[href="#calendar"]');
  if (open) {
    event.preventDefault();
    calendarSection.hidden = false;
    calendarSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
drawCalendar();

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

  renderCalendar(payload.events);

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
