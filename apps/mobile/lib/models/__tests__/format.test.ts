import {
  formatBytes,
  formatDuration,
  computeRate,
  etaSeconds,
  hasEnoughSpace,
  ramFit,
  percent,
} from "../format";

describe("formatBytes", () => {
  it("formats across units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.50 GB");
    expect(formatBytes(20 * 1024 * 1024 * 1024)).toBe("20.0 GB");
  });
  it("guards invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("formats seconds/minutes/hours", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(83)).toBe("1m 23s");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(3900)).toBe("1h 5m");
  });
  it("returns dash for unknown", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });
});

describe("computeRate", () => {
  it("computes bytes/sec from samples", () => {
    expect(computeRate(0, 1000, 1000, 2000)).toBe(1000); // 1000 bytes in 1s
  });
  it("guards non-positive intervals and regressions", () => {
    expect(computeRate(0, 1000, 1000, 1000)).toBe(0);
    expect(computeRate(2000, 1000, 1000, 2000)).toBe(0);
  });
});

describe("etaSeconds", () => {
  it("computes remaining time", () => {
    expect(etaSeconds(0, 1000, 100)).toBe(10);
    expect(etaSeconds(900, 1000, 100)).toBe(1);
  });
  it("returns null when rate or total unknown", () => {
    expect(etaSeconds(0, 1000, 0)).toBeNull();
    expect(etaSeconds(0, 0, 100)).toBeNull();
  });
});

describe("hasEnoughSpace", () => {
  it("requires size + headroom", () => {
    expect(hasEnoughSpace(1100, 1000, 1.1)).toBe(true);
    expect(hasEnoughSpace(1099, 1000, 1.1)).toBe(false);
  });
  it("does not block on unknown size", () => {
    expect(hasEnoughSpace(0, 0)).toBe(true);
  });
});

describe("ramFit", () => {
  it("classifies fit", () => {
    expect(ramFit(4096, 8192)).toBe("ok");
    expect(ramFit(4096, 5000)).toBe("tight");
    expect(ramFit(8192, 4096)).toBe("insufficient");
  });
  it("returns unknown when RAM is unknown", () => {
    expect(ramFit(4096, null)).toBe("unknown");
    expect(ramFit(null, 8192)).toBe("unknown");
  });
});

describe("percent", () => {
  it("clamps to 0..100", () => {
    expect(percent(50, 100)).toBe(50);
    expect(percent(150, 100)).toBe(100);
    expect(percent(1, 0)).toBe(0);
  });
});
