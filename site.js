document.addEventListener("DOMContentLoaded", () => {
	const navigation = document.querySelector(".site-header nav");

	if (!navigation) return;

	const menuButton = document.createElement("button");
	menuButton.className = "menu-toggle";
	menuButton.type = "button";
	menuButton.setAttribute("aria-expanded", "false");
	menuButton.setAttribute("aria-controls", "primary-menu");
	menuButton.setAttribute("aria-label", "Open navigation menu");
	menuButton.innerHTML = '<span></span><span></span><span></span>';

	const menu = navigation.querySelector(".nav-list");
	menu.id = "primary-menu";
	navigation.before(menuButton);

	menuButton.addEventListener("click", () => {
		const isOpen = navigation.classList.toggle("is-open");
		menuButton.setAttribute("aria-expanded", String(isOpen));
		menuButton.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
	});

	menu.addEventListener("click", (event) => {
		if (event.target.closest("a") && window.matchMedia("(max-width: 760px)").matches) {
			navigation.classList.remove("is-open");
			menuButton.setAttribute("aria-expanded", "false");
			menuButton.setAttribute("aria-label", "Open navigation menu");
		}
	});
});
