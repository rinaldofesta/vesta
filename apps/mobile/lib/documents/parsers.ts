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
} from "./parse-util";

export { classifyDocument, UnsupportedDocumentError } from "./parse-util";
export type { DocKind } from "./parse-util";

async function parseDocx(uri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const zip = await JSZip.loadAsync(b64, { base64: true });
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("Not a valid .docx (missing word/document.xml)");
  const xml = await entry.async("string");
  return docxXmlToText(xml);
}

async function parsePdf(uri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const data = base64ToBytes(b64);

  // Lazy-load pdfjs so its bulk + any Hermes quirks never touch app boot.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
  // Run on the JS thread: with no loadable workerSrc, pdfjs uses a fake worker.
  (pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc = "";

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
    const line = content.items
      .map((it: unknown) =>
        it && typeof (it as { str?: unknown }).str === "string"
          ? (it as { str: string }).str
          : "",
      )
      .join(" ");
    pages.push(line);
  }
  return pages.join("\n\n").trim();
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
