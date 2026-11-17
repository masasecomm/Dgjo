import mammoth from "mammoth/mammoth.browser.js";

export async function extractDocxText(file) {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}
