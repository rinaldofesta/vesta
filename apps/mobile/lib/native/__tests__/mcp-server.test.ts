const mockModule = {
  startServer: jest.fn(async () => "192.168.1.5"),
  stopServer: jest.fn(async () => {}),
  setActiveTokens: jest.fn(),
  respondMcp: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
let capturedHandler: (e: { id: string; token: string; body: string }) => void = () => {};
jest.mock("react-native", () => ({
  NativeModules: { McpServerModule: mockModule },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: (_name: string, cb: (e: { id: string; token: string; body: string }) => void) => {
      capturedHandler = cb;
      return { remove: jest.fn() };
    },
  })),
}));
jest.mock("../../mcp/mcp-server", () => ({ handleJsonRpc: jest.fn(async () => '{"jsonrpc":"2.0","id":1,"result":{}}') }));
import { startMcpServer, setActiveTokens, installMcpRequestListener } from "../mcp-server";
import { handleJsonRpc } from "../../mcp/mcp-server";

beforeEach(() => jest.clearAllMocks());

it("startMcpServer returns ip + port", async () => {
  expect(await startMcpServer(8420)).toEqual({ ip: "192.168.1.5", port: 8420 });
  expect(mockModule.startServer).toHaveBeenCalledWith(8420);
});

it("setActiveTokens forwards to native", () => {
  setActiveTokens(["a", "b"]);
  expect(mockModule.setActiveTokens).toHaveBeenCalledWith(["a", "b"]);
});

it("an mcpRequest event is handled and responded", async () => {
  installMcpRequestListener();
  await capturedHandler({ id: "r1", token: "t1", body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  expect(handleJsonRpc).toHaveBeenCalledWith('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', "t1");
  expect(mockModule.respondMcp).toHaveBeenCalledWith("r1", 200, '{"jsonrpc":"2.0","id":1,"result":{}}');
});
