import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PDF_PAGES = 50;

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export async function extractPdfText(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  if (document.numPages > MAX_PDF_PAGES) {
    await document.destroy();
    throw new Error(`This PDF has ${document.numPages} pages. The limit is ${MAX_PDF_PAGES} pages.`);
  }
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.filter(item => "str" in item).map(item => item.str).join(" "));
      page.cleanup();
    }
    return pages.join("\n");
  } finally {
    await document.destroy();
  }
}
