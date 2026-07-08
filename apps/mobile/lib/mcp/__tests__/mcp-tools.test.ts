jest.mock("../../orchestrator/tool-dispatcher", () => ({
  dispatchToolCall: jest.fn(),
}));
import { buildMcpToolList, isReadOnlyDataSource, callReadTool } from "../mcp-tools";
import { dispatchToolCall } from "../../orchestrator/tool-dispatcher";

const mockDispatch = dispatchToolCall as jest.MockedFunction<typeof dispatchToolCall>;

beforeEach(() => jest.clearAllMocks());

describe("buildMcpToolList", () => {
  it("exposes exactly the returnsData read tools with JSON-schema inputs", () => {
    const tools = buildMcpToolList();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_calendar_events", "query_document", "search_contacts"]);
    const cal = tools.find((t) => t.name === "get_calendar_events")!;
    expect(cal.description.length).toBeGreaterThan(0);
    expect(cal.inputSchema).toHaveProperty("type", "object");
    expect(cal.inputSchema).toHaveProperty("properties");
  });
});

describe("isReadOnlyDataSource", () => {
  it("is true only for the read tools", () => {
    expect(isReadOnlyDataSource("search_contacts")).toBe(true);
    expect(isReadOnlyDataSource("make_call")).toBe(false);
    expect(isReadOnlyDataSource("nonexistent")).toBe(false);
  });
});

describe("callReadTool", () => {
  it("refuses a non-read tool without dispatching", async () => {
    const res = await callReadTool("make_call", { contact: "mom" });
    expect(res).toEqual({ ok: false, error: "Unknown or non-exposed tool: make_call" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns the dispatcher's data (never a generated answer) on success", async () => {
    mockDispatch.mockResolvedValue({ success: true, message: "ok", data: '{"events":[]}' });
    const res = await callReadTool("get_calendar_events", { date: "2026-07-08" });
    expect(res).toEqual({ ok: true, text: '{"events":[]}' });
  });

  it("falls back to message when a read tool returns no data", async () => {
    mockDispatch.mockResolvedValue({ success: true, message: "Nothing relevant", data: undefined });
    const res = await callReadTool("query_document", { query: "x" });
    expect(res).toEqual({ ok: true, text: "Nothing relevant" });
  });

  it("returns an error when the dispatcher fails", async () => {
    mockDispatch.mockResolvedValue({ success: false, message: "bad", error: "boom" });
    const res = await callReadTool("search_contacts", { query: "z" });
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});
