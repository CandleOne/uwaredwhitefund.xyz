/* Shared org chart renderer for the public page (read-only) and the admin editor. */
(function () {
	const previewApi = new URLSearchParams(window.location.search).get("apiBaseUrl");
	const localApi = ["127.0.0.1", "localhost"].includes(window.location.hostname)
		? `${window.location.protocol}//${window.location.hostname}:8789` : undefined;
	const API = (previewApi || localApi || document.querySelector('meta[name="alpaca-api-base"]')?.content || "").replace(/\/$/, "");
	const APPLY_URL = "application.html";

	const common = { admin: ["Provide institutional oversight", "Receive reports from the Faculty Advisor as needed"] };
	const ROLES = {};
	for (let i = 1; i <= 4; i++) ROLES["admin" + i] = { title: "Admin", num: i, summary: "Overseeing administrator of the fund.", duties: [...common.admin] };
	Object.assign(ROLES, {
		advisor: { title: "Faculty Advisor", summary: "Executes trades on behalf of the fund and reports to the overseeing administrators as needed.", duties: ["Execute cleared trades on behalf of the fund", "Report to administrators as needed", "Provide oversight of the C-Suite"] },
		cio: { title: "Chief Investment Officer", short: "Chairs the committee; may also serve as a PM if role is unfilled", summary: "Chairs the investment committee.", duties: ["Chair committee meetings", "Vote only to break ties", "Recuse from votes on own trades if also serving as a PM", "May serve as a PM if that role is unfilled"] },
		ce: { title: "Chief Economist", short: "Macro input to PMs; may also serve as a PM if role is unfilled", summary: "Provides macroeconomic input to the portfolio managers.", duties: ["Share macro views with PMs", "May serve as a PM if that role is unfilled"] },
		cco: { title: "Chief Compliance Officer", short: "Pre-trade compliance check", summary: "Reviews trades for compliance before they go to the Faculty Advisor. Stays independent of PM duties.", duties: ["Perform pre-trade compliance checks", "Clear approved trades for execution", "Remain independent (no PM role)"] },
		cao: { title: "Chief Accounting Officer", short: "Records and reconciles trades", summary: "Maintains the fund's books. Stays independent of PM duties.", duties: ["Record trades", "Reconcile trades and positions", "Remain independent (no PM role)"] },
		cmo: { title: "Chief Marketing Officer", short: "Recruiting and communications", summary: "Leads recruiting and communications for the fund.", duties: ["Recruit new members", "Manage communications and social media"] }
	});
	for (let i = 1; i <= 7; i++) {
		ROLES["pm" + i] = { title: "Portfolio Manager", num: i, summary: "Researches equities with their analyst team and presents potential trades to the investment committee.", duties: ["Work independently with paired analyst team to research equities", "Present trade ideas at committee meetings", "Vote when holding a rotating voting seat (5 of 7 vote at any meeting)"] };
		ROLES["an" + i] = { title: "Analyst", num: i, summary: "Helps their paired portfolio manager research the equities they wish to trade.", duties: ["Research equities for the paired PM", "Prepare pitch materials and models"] };
	}
	for (const r of Object.values(ROLES)) { r.holder = ""; r.requirements = ""; }
	const DEFAULTS = JSON.parse(JSON.stringify(ROLES));
	const EDITABLE = ["holder", "summary", "duties", "requirements"];

	const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
	const label = r => r.title + (r.num ? " " + r.num : "");
	const nums = [1, 2, 3, 4, 5, 6, 7];
	const row = html => `<div class="row">${html}</div>`;
	const dirty = new Set();
	let editable = false, current = null, csrf = "";
	const panel = document.getElementById("panel"), body = document.getElementById("body"), chart = document.getElementById("chart");

	function node(id, cls = "") {
		const r = ROLES[id], open = !r.holder;
		return `<button class="node ${cls} ${open ? "open" : ""} ${dirty.has(id) ? "dirty" : ""}" data-id="${id}"><span class="t">${esc(label(r))}</span>${r.short ? `<span class="d">${esc(r.short)}</span>` : ""}<span class="n">${open ? "Open" : esc(r.holder)}</span></button>`;
	}

	function renderChart() {
		chart.innerHTML = `
		${row(["admin1", "admin2", "admin3", "admin4"].map(i => node(i)).join(""))}
		<div class="conn dash arrow"></div>
		${row(node("advisor", "lg"))}
		<div class="conn arrow"><span>Cleared trades</span></div>
		<section class="group"><h2>C-Suite</h2><p>The CIO and Chief Economist may also serve as PMs depending on participation; the CCO and CAO stay independent.</p>
			${row(["cio", "ce", "cco", "cao", "cmo"].map(i => node(i)).join(""))}</section>
		<div class="conn arrow"><span>Approved trades</span></div>
		<section class="group"><h2>Portfolio Managers &amp; Investment Committee</h2><p>The seven portfolio managers work independently with their analyst to research equities, then present trades to the committee for a vote. Voting seats rotate each meeting, so only 5 of 7 PMs vote at any time. The CIO chairs and votes only to break ties; a CIO who also serves as a PM recuses on their own trades.</p>
			${row(nums.map(i => node("pm" + i)).join(""))}</section>
		<div class="conn arrow"></div>
		${row(nums.map(i => node("an" + i)).join(""))}
		<p class="analysts-note"><b>Analysts</b><br>Each portfolio manager is paired with a team of analysts who help research the equities they wish to trade.</p>
		<div class="key"><span>- - - Reports as needed</span><span>&mdash; Oversight line</span><span>&uarr; Trade flow</span></div>`;
		if (current) document.querySelector(`[data-id="${current}"]`)?.classList.add("sel");
	}

	function show(id) {
		const r = ROLES[id], open = !r.holder;
		current = id;
		document.querySelectorAll(".node.sel").forEach(n => n.classList.remove("sel"));
		document.querySelector(`[data-id="${id}"]`).classList.add("sel");
		if (editable) {
			body.innerHTML = `<h3>${esc(label(r))}</h3>
				<label for="f-holder">Currently held by (blank = open)</label><input id="f-holder" maxlength="100" value="${esc(r.holder)}">
				<label for="f-summary">Role summary</label><textarea id="f-summary" rows="3" maxlength="500">${esc(r.summary)}</textarea>
				<label for="f-duties">Responsibilities (one per line)</label><textarea id="f-duties" rows="6">${esc(r.duties.join("\n"))}</textarea>
				<label for="f-req">Requirements for openings</label><textarea id="f-req" rows="3" maxlength="500">${esc(r.requirements)}</textarea>
				<button class="btn" id="apply-edit" type="button">Apply to chart</button>
				<p style="margin-top:10px;color:#687078;font-size:.82rem">Changes go live on the public page after you click Save &amp; publish.</p>`;
		} else {
			const same = Object.entries(ROLES).filter(([, x]) => x.title === r.title);
			const openCount = same.filter(([, x]) => !x.holder).length;
			body.innerHTML = `<h3>${esc(label(r))}</h3>
				<span class="badge ${open ? "o" : "f"}">${open ? "Open position" : "Filled"}</span>
				<h4>Role</h4><p>${esc(r.summary)}</p>
				<h4>Responsibilities</h4><ul>${r.duties.map(d => `<li>${esc(d)}</li>`).join("")}</ul>
				<h4>Currently held by</h4><p>${open ? "Vacant &mdash; no one currently holds this role." : esc(r.holder)}</p>
				${r.requirements ? `<h4>Requirements</h4><p>${esc(r.requirements)}</p>` : ""}
				<h4>Openings</h4>
				${same.length > 1 ? `<p>${openCount} of ${same.length} ${esc(r.title)} seats open:</p>` + same.map(([k, x]) => `<div class="slot"><a href="#" data-jump="${k}">${esc(label(x))}</a><span>${x.holder ? esc(x.holder) : "Open"}</span></div>`).join("") : `<p>${open ? "This position is open." : "No openings."}</p>`}
				${open ? `<a class="apply" href="${APPLY_URL}">Apply now</a>` : ""}`;
		}
		panel.classList.add("show");
	}

	function hide() { panel.classList.remove("show"); current = null; document.querySelectorAll(".node.sel").forEach(n => n.classList.remove("sel")); }

	function merge(saved) {
		for (const [key, vals] of Object.entries(saved || {})) {
			if (!ROLES[key]) continue;
			for (const f of EDITABLE) if (f in vals) ROLES[key][f] = vals[f];
		}
	}

	async function load() {
		try {
			const res = await fetch(`${API}/v1/org-chart`, { credentials: "include" });
			if (res.ok) merge((await res.json()).roles);
		} catch (e) { console.error("Unable to load org chart data:", e); }
	}

	function setMsg(text, cls) { const m = document.getElementById("msg"); if (m) { m.textContent = text; m.className = cls || ""; } }

	async function save() {
		const btn = document.getElementById("save"); btn.disabled = true; setMsg("Saving…");
		const roles = {};
		for (const [k, r] of Object.entries(ROLES)) roles[k] = Object.fromEntries(EDITABLE.map(f => [f, r[f]]));
		try {
			const res = await fetch(`${API}/v1/org-chart`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ roles }) });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || "Save failed.");
			dirty.clear(); renderChart(); setMsg("Published to the public org chart.", "ok");
		} catch (e) { setMsg(e.message, "err"); }
		btn.disabled = false;
	}

	async function authorize() {
		try {
			const res = await fetch(`${API}/v1/auth/status`, { credentials: "include" });
			const s = await res.json();
			if (!res.ok || !s.authenticated || s.user.role !== "manager" || !s.csrf_token) throw new Error();
			csrf = s.csrf_token; return true;
		} catch { window.location.replace("login.html"); return false; }
	}

	chart.addEventListener("click", e => { const n = e.target.closest(".node"); if (n) show(n.dataset.id); });
	body.addEventListener("click", e => {
		const a = e.target.closest("[data-jump]");
		if (a) { e.preventDefault(); show(a.dataset.jump); return; }
		if (e.target.id === "apply-edit" && current) {
			const r = ROLES[current];
			r.holder = document.getElementById("f-holder").value.trim();
			r.summary = document.getElementById("f-summary").value.trim();
			r.duties = document.getElementById("f-duties").value.split("\n").map(x => x.trim()).filter(Boolean);
			r.requirements = document.getElementById("f-req").value.trim();
			dirty.add(current); renderChart(); setMsg("Unsaved changes — click Save & publish.");
			document.getElementById("save").disabled = false;
		}
	});
	document.getElementById("close").onclick = hide;
	document.addEventListener("keydown", e => { if (e.key === "Escape") hide(); });

	window.OrgChart = {
		async init(opts = {}) {
			editable = !!opts.editable;
			if (editable) {
				if (!(await authorize())) return;
				document.getElementById("save").onclick = save;
				document.getElementById("save").disabled = true;
				document.getElementById("reset").onclick = async () => { Object.assign(ROLES, JSON.parse(JSON.stringify(DEFAULTS))); await load(); dirty.clear(); renderChart(); hide(); setMsg("Reloaded published version."); };
			}
			renderChart();
			await load();
			renderChart();
		}
	};
})();
