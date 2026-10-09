const previewApiBaseUrl = new URLSearchParams(window.location.search).get("apiBaseUrl");
const localApiBaseUrl = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? `${window.location.protocol}//${window.location.hostname}:8789`
  : undefined;
const apiBaseUrl = (previewApiBaseUrl || localApiBaseUrl || document.querySelector('meta[name="alpaca-api-base"]')?.content).replace(/\/$/, "");

function positionResearchVideo() {
  const portal = document.querySelector(".research-portal");
  const video = document.querySelector(".research-video");
  if (!portal || !video) return;
  video.style.top = `${portal.getBoundingClientRect().top + window.scrollY}px`;
}

async function requireMember() {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/auth/status`, { credentials: "include" });
    const status = await response.json();
    if (!response.ok || !status.authenticated) {
      const loginUrl = previewApiBaseUrl ? `login.html?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}` : "login.html";
      window.location.replace(loginUrl);
    }
  } catch (error) {
    console.error("Unable to verify member session:", error);
    window.location.replace("login.html");
  }
}

requireMember();
positionResearchVideo();
window.addEventListener("resize", positionResearchVideo);
