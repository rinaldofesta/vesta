// Minimal DOM polyfills so pdfjs can *evaluate* under Hermes. pdfjs references
// browser globals (DOMException, DOMMatrix) at module-load time, which otherwise
// throw "Cannot read property 'prototype' of undefined" before any try/catch can
// run. Installed synchronously right before the dynamic import of pdfjs.

export function installPdfPolyfills(): void {
  const g = globalThis as Record<string, unknown>;

  if (typeof g.DOMException === "undefined") {
    class DOMExceptionPolyfill extends Error {
      constructor(message?: string, name?: string) {
        super(message);
        this.name = name ?? "DOMException";
      }
    }
    g.DOMException = DOMExceptionPolyfill;
  }

  if (typeof g.DOMMatrix === "undefined") {
    // Identity matrix with no-op mutators — text extraction uses pdfjs' own Util
    // matrix math; DOMMatrix is only referenced structurally at load.
    class DOMMatrixPolyfill {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      multiplySelf() {
        return this;
      }
      preMultiplySelf() {
        return this;
      }
      translateSelf() {
        return this;
      }
      scaleSelf() {
        return this;
      }
    }
    g.DOMMatrix = DOMMatrixPolyfill;
  }
}
