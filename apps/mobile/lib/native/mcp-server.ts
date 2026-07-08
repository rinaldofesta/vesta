// TS wrapper over the native McpServerModule + the request event bridge. The
// native HTTP thread blocks on a CompletableFuture keyed by `id`; we run the
// JSON-RPC engine and call respondMcp(id, ...) to release it.

import { NativeModules, NativeEventEmitter } from "react-native";
import { handleJsonRpc } from "../mcp/mcp-server";

const Mod = NativeModules.McpServerModule as {
  startServer(port: number): Promise<string>;
  stopServer(): Promise<void>;
  setActiveTokens(tokens: string[]): void;
  respondMcp(id: string, status: number, body: string): void;
};

export async function startMcpServer(port: number): Promise<{ ip: string; port: number }> {
  const ip = await Mod.startServer(port);
  return { ip, port };
}

export function stopMcpServer(): Promise<void> {
  return Mod.stopServer();
}

export function setActiveTokens(tokens: string[]): void {
  Mod.setActiveTokens(tokens);
}

export function installMcpRequestListener(): () => void {
  const emitter = new NativeEventEmitter(NativeModules.McpServerModule);
  const sub = emitter.addListener(
    "mcpRequest",
    (e: { id: string; token: string; body: string }) => {
      handleJsonRpc(e.body, e.token)
        .then((body) => Mod.respondMcp(e.id, 200, body))
        .catch(() => Mod.respondMcp(e.id, 500, ""));
    },
  );
  return () => sub.remove();
}
