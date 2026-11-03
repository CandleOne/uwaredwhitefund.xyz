(() => {
  const form = document.querySelector("[data-team-login]");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const teamId = form.elements.teamId.value.trim().toLowerCase();
    const teamKey = form.elements.teamKey.value.trim();
    if (!teamId || !teamKey) return;
    sessionStorage.setItem("cmp-last-team", teamId);
    sessionStorage.setItem(`cmp-key-${teamId}`, teamKey);
    window.location.href = `competition-team.html?team=${encodeURIComponent(teamId)}`;
  });
})();
