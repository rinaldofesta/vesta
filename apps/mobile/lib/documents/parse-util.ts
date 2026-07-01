// Pure text-extraction helpers (no expo/jszip/pdfjs imports), so they're
// unit-testable in isolation. The I/O parsers in parsers.ts build on these.

export type DocKind = "txt" | "md" | "docx" | "pdf";

export class UnsupportedDocumentError extends Error {
  constructor(ext: string) {
    super(`Unsupported document type: ${ext || "unknown"}`);
    this.name = "UnsupportedDocumentError";
  }
}

// Map a filename/mime to a supported kind, or null if unsupported.
export function classifyDocument(
  filename: string,
  mime?: string | null,
): DocKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  // Fall back to mime when the extension is absent/ambiguous.
  if (mime) {
    if (mime === "application/pdf") return "pdf";
    if (mime.includes("wordprocessingml")) return "docx";
    if (mime === "text/markdown") return "md";
    if (mime.startsWith("text/")) return "txt";
  }
  return null;
}

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Base64 → bytes without relying on atob/Buffer (unreliable under Hermes).
export function base64ToBytes(b64: string): Uint8Array {
  const lookup = new Uint8Array(256);
  for (let i = 0; i < B64_ALPHABET.length; i++) lookup[B64_ALPHABET.charCodeAt(i)] = i;
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const len = clean.length;
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const byteLen = Math.max(0, Math.floor((len * 3) / 4) - pad);
  const bytes = new Uint8Array(byteLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const e0 = lookup[clean.charCodeAt(i)];
    const e1 = lookup[clean.charCodeAt(i + 1)];
    const e2 = lookup[clean.charCodeAt(i + 2)];
    const e3 = lookup[clean.charCodeAt(i + 3)];
    const chunk = (e0 << 18) | (e1 << 12) | (e2 << 6) | e3;
    if (p < byteLen) bytes[p++] = (chunk >> 16) & 0xff;
    if (p < byteLen) bytes[p++] = (chunk >> 8) & 0xff;
    if (p < byteLen) bytes[p++] = chunk & 0xff;
  }
  return bytes;
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// Convert a WordprocessingML body to plain text: paragraph/line/tab tags become
// whitespace, everything else is stripped, entities decoded.
export function docxXmlToText(xml: string): string {
  let text = xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<[^>]+>/g, "");
  text = decodeXmlEntities(text);
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
