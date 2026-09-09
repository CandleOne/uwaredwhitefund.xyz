import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
	"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const documentContainer = document.querySelector(".ips-document");
const previousButton = document.querySelector(".ips-previous");
const nextButton = document.querySelector(".ips-next");
const pageCount = document.querySelector(".ips-page-count");

if (documentContainer) {
	const source = documentContainer.dataset.pdfSource;
	const status = document.createElement("p");
	status.className = "ips-status";
	status.textContent = "Loading Investment Policy Statement...";
	documentContainer.append(status);

	try {
		const pdf = await pdfjsLib.getDocument(source).promise;
		status.remove();

		for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
			const page = await pdf.getPage(pageNumber);
			const unscaledViewport = page.getViewport({ scale: 1 });
			const availableWidth = Math.min(documentContainer.clientWidth - 72, 850);
			const availableHeight = documentContainer.clientHeight - 72;
			const scale = Math.min(
				availableWidth / unscaledViewport.width,
				availableHeight / unscaledViewport.height,
			);
			const viewport = page.getViewport({ scale });
			const canvas = document.createElement("canvas");
			const context = canvas.getContext("2d");
			const outputScale = Math.max(window.devicePixelRatio || 1, 2);

			canvas.className = "ips-page";
			canvas.width = Math.floor(viewport.width * outputScale);
			canvas.height = Math.floor(viewport.height * outputScale);
			canvas.style.width = `${Math.floor(viewport.width)}px`;
			canvas.style.height = `${Math.floor(viewport.height)}px`;
			canvas.setAttribute("aria-label", `Investment Policy Statement, page ${pageNumber}`);
			canvas.setAttribute("role", "img");
			documentContainer.append(canvas);

			await page.render({
				canvasContext: context,
				transform: [outputScale, 0, 0, outputScale, 0, 0],
				viewport,
			}).promise;
		}

		const pages = [...documentContainer.querySelectorAll(".ips-page")];
		const getCurrentPageIndex = () => pages.reduce(
			(closestIndex, page, pageIndex) => (
				Math.abs(page.offsetTop - documentContainer.scrollTop) <
				Math.abs(pages[closestIndex].offsetTop - documentContainer.scrollTop)
					? pageIndex
					: closestIndex
			),
			0,
		);
		const updateControls = () => {
			const currentPageIndex = getCurrentPageIndex();
			previousButton.disabled = currentPageIndex === 0;
			nextButton.disabled = currentPageIndex === pages.length - 1;
			pageCount.textContent = `Page ${currentPageIndex + 1} of ${pages.length}`;
		};
		const navigate = (pageOffset) => {
			const nextPageIndex = Math.max(0, Math.min(pages.length - 1, getCurrentPageIndex() + pageOffset));
			documentContainer.scrollTo({ top: pages[nextPageIndex].offsetTop, behavior: "smooth" });
		};

		previousButton.addEventListener("click", () => navigate(-1));
		nextButton.addEventListener("click", () => navigate(1));
		documentContainer.addEventListener("scroll", updateControls, { passive: true });
		updateControls();
	} catch (error) {
		status.textContent = "The Investment Policy Statement could not be displayed.";
		const fallbackLink = document.createElement("a");
		fallbackLink.href = source;
		fallbackLink.textContent = "Open the Investment Policy Statement PDF.";
		status.append(document.createElement("br"));
		status.append(fallbackLink);
	}
}
