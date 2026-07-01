// Offline text extraction for imported documents. TXT/MD are read directly;
// DOCX is unzipped and its word/document.xml stripped to text; PDF text is
// extracted via pdfjs (lazy-loaded, worker disabled — runs on the JS thread).
//
// Pure string/byte helpers live in parse-util.ts; this module adds the file I/O
// and the fragile PDF path (pdfjs is imported lazily and guarded so a failure
// surfaces as a clean error instead of crashing import).

import * as FileSystem from "expo-file-system/legacy";
import JSZip from "jszip";
import {
  classifyDocument,
  base64ToBytes,
  docxXmlToText,
  UnsupportedDocumentError,
  DocumentParseError,
} from "./parse-util";
import { installPdfPolyfills } from "./pdf-polyfills";

export {
  classifyDocument,
  UnsupportedDocumentError,
  DocumentParseError,
} from "./parse-util";
export type { DocKind } from "./parse-util";

async function parseDocx(uri: string): Promise<string> {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const zip = await JSZip.loadAsync(b64, { base64: true });
    const entry = zip.file("word/document.xml");
    if (!entry) throw new Error("Not a valid .docx (missing word/document.xml)");
    const xml = await entry.async("string");
    return docxXmlToText(xml);
  } catch (err) {
    if (err instanceof DocumentParseError) throw err;
    throw new DocumentParseError(err);
  }
}

// Populate the main-thread pdfjs worker once. On Hermes there is no DOM and no
// web worker, so pdfjs can't load pdf.worker.js by URL; instead we import the
// worker module and expose its WorkerMessageHandler on globalThis, which pdfjs'
// fake-worker path picks up to run entirely on the JS thread.
let pdfWorkerReady = false;
async function ensurePdfWorker(pdfjs: typeof import("pdfjs-dist/legacy/build/pdf")) {
  if (pdfWorkerReady) return;
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker");
  const g = globalThis as { pdfjsWorker?: unknown };
  // The worker module's exports include WorkerMessageHandler.
  g.pdfjsWorker = worker;
  // Must be non-empty or pdfjs throws "No workerSrc specified" before falling
  // back to the main-thread handler.
  (pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc = "vesta-inline";
  pdfWorkerReady = true;
}

async function parsePdf(uri: string): Promise<string> {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const data = base64ToBytes(b64);

    // Install DOM polyfills BEFORE importing pdfjs — it reads browser globals at
    // module-load time and would otherwise throw uncatchably under Hermes.
    installPdfPolyfills();

    // Lazy-load pdfjs so its bulk + Hermes quirks never touch app boot.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
    await ensurePdfWorker(pdfjs);

    const loadingTask = pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
    });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Preserve line breaks (hasEOL) so the chunker sees paragraph structure.
      let line = "";
      for (const it of content.items as { str?: unknown; hasEOL?: boolean }[]) {
        if (typeof it.str === "string") line += it.str;
        if (it.hasEOL) line += "\n";
        else line += " ";
      }
      pages.push(line.trim());
    }
    return pages.join("\n\n").trim();
  } catch (err) {
    if (err instanceof DocumentParseError) throw err;
    throw new DocumentParseError(err);
  }
}

// Extract plain text from a document by URI. Throws UnsupportedDocumentError for
// unknown types, or a descriptive Error on parse failure.
export async function parseDocument(
  uri: string,
  filename: string,
  mime?: string | null,
): Promise<string> {
  const kind = classifyDocument(filename, mime);
  if (!kind) throw new UnsupportedDocumentError(filename.split(".").pop() ?? "");
  switch (kind) {
    case "txt":
    case "md":
      return (await FileSystem.readAsStringAsync(uri)).trim();
    case "docx":
      return parseDocx(uri);
    case "pdf":
      return parsePdf(uri);
  }
}
