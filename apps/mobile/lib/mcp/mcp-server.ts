// Minimal MCP server over JSON-RPC 2.0: initialize, tools/list, tools/call.
// Streamable HTTP subset — request/response only, no SSE, no server
// notifications. Pure logic; the native layer supplies the body + auth token.

import { buildMcpToolList, callReadTool } from "./mcp-tools";
import { touch } from "./pairing-store";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function ok(id: unknown, result: unknown): object {
  return { jsonrpc: "2.0", id, result };
}
function err(id: unknown, code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function handleJsonRpc(bodyText: string, token: string): Promise<string> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(bodyText);
  } catch {
    return JSON.stringify(err(null, -32700, "Parse error"));
  }

  // A valid-JSON body that isn't an object (null, a number, a string, an array)
  // parses fine but is not a JSON-RPC request. Reject it before touching req.id
  // so handleJsonRpc keeps its never-throws contract.
  if (req === null || typeof req !== "object" || Array.isArray(req)) {
    return JSON.stringify(err(null, -32600, "Invalid Request"));
  }

  // Notifications (no id) get no response body.
  const isNotification = req.id === undefined;

  let response: object | null = null;
  try {
    switch (req.method) {
      case "initialize":
        response = ok(req.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "vesta", version: "0.2.0" },
        });
        break;
      case "notifications/initialized":
        response = null; // handshake ack, no reply
        break;
      case "tools/list":
        response = ok(req.id, { tools: buildMcpToolList() });
        break;
      case "tools/call": {
        const name = String(req.params?.name ?? "");
        const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
        const result = await callReadTool(name, args);
        await touch(token);
        response = result.ok
          ? ok(req.id, { content: [{ type: "text", text: result.text }] })
          : ok(req.id, { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true });
        break;
      }
      default:
        response = err(req.id, -32601, `Method not found: ${req.method}`);
    }
  } catch (e) {
    response = err(req.id ?? null, -32603, e instanceof Error ? e.message : String(e));
  }

  if (isNotification || response === null) return "";
  return JSON.stringify(response);
}
