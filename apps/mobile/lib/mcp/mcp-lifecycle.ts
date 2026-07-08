// Enable/disable the MCP server: token push → listener → native start, persisted
// so it can be restored on launch. Server is OFF by default.

import {
  startMcpServer,
  stopMcpServer,
  installMcpRequestListener,
} from "../native/mcp-server";
import { pushActiveTokens } from "./pairing-store";
import { getConfig, setConfig } from "../storage/database";

export const MCP_PORT = 8420;

let removeListener: (() => void) | null = null;

export async function enableMcpServer(): Promise<{ ip: string; port: number }> {
  removeListener?.();
  removeListener = installMcpRequestListener();
  await pushActiveTokens();
  const res = await startMcpServer(MCP_PORT);
  await setConfig("mcp_enabled", "true");
  return res;
}

export async function disableMcpServer(): Promise<void> {
  await stopMcpServer();
  removeListener?.();
  removeListener = null;
  await setConfig("mcp_enabled", "false");
}

export async function isMcpEnabled(): Promise<boolean> {
  return (await getConfig("mcp_enabled")) === "true";
}
