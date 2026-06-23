import { CATALOG, getCatalogModel } from "../catalog";

describe("CATALOG", () => {
  it("has unique ids", () => {
    const ids = CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry is well-formed", () => {
    for (const m of CATALOG) {
      expect(m.hfRepo).toContain("/");
      expect(m.preferredFile.toLowerCase().endsWith(".gguf")).toBe(true);
      expect(m.sizeBytesApprox).toBeGreaterThan(0);
      expect(m.minRamMb).toBeGreaterThan(0);
      expect(m.contextSize).toBeGreaterThan(0);
      expect(["primary", "router", "embedding"]).toContain(m.role);
      expect(["phone", "tablet", "any"]).toContain(m.recommendedFor);
      expect(m.license.length).toBeGreaterThan(0);
    }
  });

  it("lookup by id works", () => {
    expect(getCatalogModel("qwen3-4b-q4")?.displayName).toBe("Qwen3 4B");
    expect(getCatalogModel("nope")).toBeUndefined();
  });
});
