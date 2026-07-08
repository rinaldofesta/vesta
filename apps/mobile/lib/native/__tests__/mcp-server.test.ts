import { NativeModules, DeviceEventEmitter } from "react-native";

jest.mock("../../mcp/mcp-server", () => ({
  handleJsonRpc: jest.fn(async () => '{"jsonrpc":"2.0","id":1,"result":{}}'),
}));

import {
  startMcpServer,
  setActiveTokens,
  installMcpRequestListener,
} from "../mcp-server";
import { handleJsonRpc } from "../../mcp/mcp-server";

// A full jest.mock("react-native", ...) does NOT apply under the jest-expo
// preset, so we inject the fake native module onto the real NativeModules and
// drive the event bridge through DeviceEventEmitter (the same RCTDeviceEventEmitter
// channel a real NativeEventEmitter subscribes to). addListener/removeListeners
// are present because NativeEventEmitter's constructor calls them.
const mockModule = {
  startServer: jest.fn(async () => "192.168.1.5"),
  stopServer: jest.fn(async () => {}),
  setActiveTokens: jest.fn(),
  respondMcp: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (NativeModules as unknown as { McpServerModule: typeof mockModule }).McpServerModule = mockModule;
});

it("startMcpServer returns ip + port", async () => {
  expect(await startMcpServer(8420)).toEqual({ ip: "192.168.1.5", port: 8420 });
  expect(mockModule.startServer).toHaveBeenCalledWith(8420);
});

it("setActiveTokens forwards to native", () => {
  setActiveTokens(["a", "b"]);
  expect(mockModule.setActiveTokens).toHaveBeenCalledWith(["a", "b"]);
});

it("an mcpRequest event is handled and responded", async () => {
  const unsub = installMcpRequestListener();
  DeviceEventEmitter.emit("mcpRequest", {
    id: "r1",
    token: "t1",
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
  });
  // Let the async handler's promise chain (.then) flush.
  await new Promise((resolve) => setImmediate(resolve));
  expect(handleJsonRpc).toHaveBeenCalledWith(
    '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    "t1",
  );
  expect(mockModule.respondMcp).toHaveBeenCalledWith(
    "r1",
    200,
    '{"jsonrpc":"2.0","id":1,"result":{}}',
  );
  unsub();
});
