(() => {
  const form = document.querySelector("[data-team-login]");
  const modal = document.querySelector("[data-team-login-modal]");
  const openButton = document.querySelector("[data-team-login-open]");
  const closeButton = document.querySelector("[data-team-login-close]");
  if (!form || !modal || !openButton || !closeButton) return;

  function openModal() {
    modal.hidden = false;
    modal.classList.add("is-open");
    form.elements.teamId.focus();
  }

  function closeModal() {
    modal.hidden = true;
    modal.classList.remove("is-open");
    openButton.focus();
  }

  openButton.addEventListener("click", openModal);
  closeButton.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

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
