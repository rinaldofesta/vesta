jest.mock("../mcp-tools", () => ({
  buildMcpToolList: jest.fn(() => [{ name: "search_contacts", description: "d", inputSchema: { type: "object" } }]),
  callReadTool: jest.fn(),
}));
jest.mock("../pairing-store", () => ({ touch: jest.fn(async () => {}) }));
import { handleJsonRpc } from "../mcp-server";
import { callReadTool } from "../mcp-tools";
import { touch } from "../pairing-store";

const mockCall = callReadTool as jest.MockedFunction<typeof callReadTool>;
beforeEach(() => jest.clearAllMocks());
const parse = async (body: object, token = "t1") => JSON.parse(await handleJsonRpc(JSON.stringify(body), token));

it("initialize returns protocol + server info", async () => {
  const res = await parse({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  expect(res.jsonrpc).toBe("2.0");
  expect(res.id).toBe(1);
  expect(res.result.serverInfo.name).toBe("vesta");
  expect(res.result.capabilities).toHaveProperty("tools");
  expect(res.result.protocolVersion).toBe("2025-06-18");
});

it("tools/list returns the exposed tools", async () => {
  const res = await parse({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  expect(res.result.tools).toHaveLength(1);
  expect(res.result.tools[0].name).toBe("search_contacts");
});

it("tools/call returns text content and touches the client", async () => {
  mockCall.mockResolvedValue({ ok: true, text: '{"contacts":[]}' });
  const res = await parse({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_contacts", arguments: { query: "mom" } } });
  expect(res.result.content).toEqual([{ type: "text", text: '{"contacts":[]}' }]);
  expect(res.result.isError).toBeUndefined();
  expect(mockCall).toHaveBeenCalledWith("search_contacts", { query: "mom" });
  expect(touch).toHaveBeenCalledWith("t1");
});

it("tools/call surfaces a tool error as isError content, not a protocol error", async () => {
  mockCall.mockResolvedValue({ ok: false, error: "boom" });
  const res = await parse({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_contacts", arguments: {} } });
  expect(res.result.isError).toBe(true);
  expect(res.result.content[0].text).toContain("boom");
  expect(res.error).toBeUndefined();
});

it("unknown method → JSON-RPC error -32601", async () => {
  const res = await parse({ jsonrpc: "2.0", id: 5, method: "nope", params: {} });
  expect(res.error.code).toBe(-32601);
});

it("malformed JSON → parse error -32700 with null id", async () => {
  const res = JSON.parse(await handleJsonRpc("{not json", "t1"));
  expect(res.error.code).toBe(-32700);
  expect(res.id).toBeNull();
});

it("notification (no id) produces an empty response body", async () => {
  const body = await handleJsonRpc(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), "t1");
  expect(body).toBe("");
});

it("a null JSON body is an Invalid Request, not a throw", async () => {
  const res = JSON.parse(await handleJsonRpc("null", "t1"));
  expect(res.error.code).toBe(-32600);
  expect(res.id).toBeNull();
});

it("a top-level primitive body is an Invalid Request", async () => {
  const res = JSON.parse(await handleJsonRpc("42", "t1"));
  expect(res.error.code).toBe(-32600);
});
