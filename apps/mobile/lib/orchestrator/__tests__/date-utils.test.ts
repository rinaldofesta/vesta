import { pad2, localDateStr, addDays, isValidYMD } from "../date-utils";

describe("pad2", () => {
  it("zero-pads single digits", () => {
    expect(pad2(3)).toBe("03");
    expect(pad2(12)).toBe("12");
  });
});

describe("localDateStr", () => {
  it("formats from LOCAL components (not UTC)", () => {
    // Constructed with local components → no UTC shift regardless of TZ.
    expect(localDateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDateStr(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
  it("near local midnight stays on the local day", () => {
    expect(localDateStr(new Date(2026, 5, 23, 23, 59))).toBe("2026-06-23");
    expect(localDateStr(new Date(2026, 5, 24, 0, 1))).toBe("2026-06-24");
  });
});

describe("addDays", () => {
  it("advances across month/year boundaries", () => {
    expect(localDateStr(addDays(new Date(2026, 0, 31), 1))).toBe("2026-02-01");
    expect(localDateStr(addDays(new Date(2026, 11, 31), 1))).toBe("2027-01-01");
  });
  it("does not mutate the input", () => {
    const d = new Date(2026, 5, 23);
    addDays(d, 5);
    expect(localDateStr(d)).toBe("2026-06-23");
  });
});

describe("isValidYMD", () => {
  it("accepts real dates", () => {
    expect(isValidYMD("2026-02-28")).toBe(true);
    expect(isValidYMD("2028-02-29")).toBe(true); // leap year
  });
  it("rejects impossible days that new Date() would roll over", () => {
    expect(isValidYMD("2026-02-30")).toBe(false);
    expect(isValidYMD("2026-04-31")).toBe(false);
    expect(isValidYMD("2026-02-29")).toBe(false); // non-leap
  });
  it("rejects malformed / out-of-range", () => {
    expect(isValidYMD("2026-13-01")).toBe(false);
    expect(isValidYMD("2026-00-10")).toBe(false);
    expect(isValidYMD("2026-1-1")).toBe(false);
    expect(isValidYMD("not-a-date")).toBe(false);
  });
});
