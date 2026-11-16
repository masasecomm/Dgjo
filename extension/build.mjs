import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["admin.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  outfile: "admin.bundle.js"
});

await mkdir("vendor", { recursive: true });
await copyFile(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  "vendor/pdf.worker.min.mjs"
);
