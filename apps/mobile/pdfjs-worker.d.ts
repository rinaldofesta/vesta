// The pdfjs worker build has no bundled types; we import it only to populate
// globalThis.pdfjsWorker so pdfjs can run on the JS thread (no DOM/web worker).
declare module "pdfjs-dist/legacy/build/pdf.worker";
