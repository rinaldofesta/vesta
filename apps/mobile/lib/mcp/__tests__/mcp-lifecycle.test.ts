jest.mock("../../native/mcp-server", () => ({
  startMcpServer: jest.fn(async () => ({ ip: "10.0.0.2", port: 8420 })),
  stopMcpServer: jest.fn(async () => {}),
  installMcpRequestListener: jest.fn(() => jest.fn()),
}));
jest.mock("../pairing-store", () => ({ pushActiveTokens: jest.fn(async () => {}) }));
jest.mock("../../storage/database", () => ({
  getConfig: jest.fn(async () => "false"),
  setConfig: jest.fn(async () => {}),
}));
import { enableMcpServer, disableMcpServer, isMcpEnabled, MCP_PORT } from "../mcp-lifecycle";
import { startMcpServer, stopMcpServer, installMcpRequestListener } from "../../native/mcp-server";
import { pushActiveTokens } from "../pairing-store";
import { setConfig, getConfig } from "../../storage/database";

beforeEach(() => jest.clearAllMocks());

it("enable installs the listener, pushes tokens, starts, and persists", async () => {
  const res = await enableMcpServer();
  expect(res).toEqual({ ip: "10.0.0.2", port: 8420 });
  expect(installMcpRequestListener).toHaveBeenCalled();
  expect(pushActiveTokens).toHaveBeenCalled();
  expect(startMcpServer).toHaveBeenCalledWith(MCP_PORT);
  expect(setConfig).toHaveBeenCalledWith("mcp_enabled", "true");
});

it("disable stops the server, removes the listener, and persists", async () => {
  const unsub = jest.fn();
  (installMcpRequestListener as jest.Mock).mockReturnValue(unsub);
  await enableMcpServer();
  await disableMcpServer();
  expect(stopMcpServer).toHaveBeenCalled();
  expect(unsub).toHaveBeenCalled();
  expect(setConfig).toHaveBeenCalledWith("mcp_enabled", "false");
});

it("isMcpEnabled reads config", async () => {
  (getConfig as jest.Mock).mockResolvedValue("true");
  expect(await isMcpEnabled()).toBe(true);
});
