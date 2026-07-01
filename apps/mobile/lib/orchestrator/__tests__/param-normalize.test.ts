// Regression test for the on-device failure found in the Fase 4 spot checks:
// "che appuntamenti ho domani" routed correctly to get_calendar_events but the
// model emitted date "2026-07-02T00:00:00" (the prompt's general datetime
// format) where the tool schema wants bare YYYY-MM-DD, and validation rejected
// the call with "Invalid parameters". Date-formatted params must be truncated,
// not rejected, when they arrive as a full ISO datetime.

// tool-dispatcher transitively imports the embedding engine via
// document-retriever; mock that away so the real dispatcher module loads.
jest.mock("../document-retriever", () => ({
  queryDocuments: jest.fn(),
}));

import { normalizeToolParams } from "../tool-dispatcher";

describe("normalizeToolParams", () => {
  test("truncates a full ISO datetime to YYYY-MM-DD for date-formatted params", () => {
    const out = normalizeToolParams("get_calendar_events", {
      date: "2026-07-02T00:00:00",
    });
    expect(out.date).toBe("2026-07-02");
  });

  test("also covers set_alarm's optional date param", () => {
    const out = normalizeToolParams("set_alarm", {
      time: "07:30",
      date: "2026-07-02T07:30:00",
    });
    expect(out.date).toBe("2026-07-02");
    expect(out.time).toBe("07:30"); // untouched
  });

  test("leaves bare dates, datetimes on ISO8601 params, and junk alone", () => {
    expect(
      normalizeToolParams("get_calendar_events", { date: "2026-07-02" }).date,
    ).toBe("2026-07-02");
    // create_event.start is ISO8601: a full datetime is the CORRECT shape.
    expect(
      normalizeToolParams("create_event", {
        title: "x",
        start: "2026-07-02T15:00:00",
      }).start,
    ).toBe("2026-07-02T15:00:00");
    // Invalid leading date → not a truncation candidate; validator will report it.
    expect(
      normalizeToolParams("get_calendar_events", { date: "2026-02-30T00:00:00" })
        .date,
    ).toBe("2026-02-30T00:00:00");
    expect(
      normalizeToolParams("unknown_tool", { date: "2026-07-02T00:00:00" }).date,
    ).toBe("2026-07-02T00:00:00");
  });
});
