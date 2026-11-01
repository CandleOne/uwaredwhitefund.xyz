(() => {
  const C = window.Competition;
  const form = document.querySelector("[data-form]");
  const membersBox = document.querySelector("[data-members]");
  const addButton = document.querySelector("[data-add-member]");
  const submit = document.querySelector("[data-submit]");
  const errorEl = document.querySelector("[data-error]");
  const phaseEl = document.querySelector("[data-phase]");
  const success = document.querySelector("[data-success]");
  const MAX = 4;

  function addMember() {
    const count = membersBox.querySelectorAll(".member-row").length;
    if (count >= MAX) return;
    const row = document.createElement("div");
    row.className = "member-row";
    const label = count === 0 ? "Team lead" : `Member ${count + 1}`;
    for (const [field, type, text] of [["name", "text", `${label} name`], ["email", "email", `${label} email`]]) {
      const wrap = document.createElement("label");
      wrap.textContent = text;
      const input = document.createElement("input");
      input.type = type;
      input.dataset.field = field;
      input.required = count === 0;
      input.maxLength = field === "name" ? 80 : 120;
      input.autocomplete = field === "email" ? "email" : "off";
      wrap.append(input);
      row.append(wrap);
    }
    membersBox.append(row);
    addButton.hidden = count + 1 >= MAX;
  }

  async function init() {
    addMember();
    try {
      const config = await C.api("/config");
      phaseEl.textContent = C.phaseMessage(config);
      if (!config.registrationOpen) {
        form.hidden = true;
      }
    } catch (err) {
      phaseEl.textContent = "Registration status is unavailable right now.";
      C.showError(errorEl, err.message);
    }
  }

  addButton.addEventListener("click", addMember);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    C.showError(errorEl, "");
    const members = [...membersBox.querySelectorAll(".member-row")]
      .map((row) => ({
        name: row.querySelector('[data-field="name"]').value.trim(),
        email: row.querySelector('[data-field="email"]').value.trim(),
      }))
      .filter((m) => m.name || m.email);

    submit.disabled = true;
    submit.textContent = "Creating your portfolio…";
    try {
      const result = await C.api("/register", {
        method: "POST",
        body: {
          teamName: form.elements.teamName.value,
          members,
          website: form.elements.website.value,
        },
      });
      sessionStorage.setItem(`cmp-key-${result.teamId}`, result.teamKey);
      sessionStorage.setItem("cmp-last-team", result.teamId);
      document.querySelector("[data-team-id]").textContent = result.teamId;
      document.querySelector("[data-key]").textContent = result.teamKey;
      document.querySelector("[data-team-link]").href = `competition-team.html?team=${encodeURIComponent(result.teamId)}`;
      document.querySelector("[data-funding-note]").textContent =
        result.status === "active"
          ? "Your $100,000 portfolio is funded and ready."
          : "Your portfolio is being funded. This usually finishes within a few minutes, and trading unlocks once it does.";
      form.hidden = true;
      success.hidden = false;
      success.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      C.showError(errorEl, err.message);
      submit.disabled = false;
      submit.textContent = "Create team and portfolio";
    }
  });

  init();
})();
