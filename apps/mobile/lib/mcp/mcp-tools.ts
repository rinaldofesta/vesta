// Maps Vesta's read-only tools (registry `returnsData: true`) to MCP tool
// definitions and routes MCP tools/call to the dispatcher's DATA path. Over MCP
// the host agent is the reasoner, so we return the tool's structured data
// (ToolCallResult.data) and never run the orchestrator's re-generation.

import { MVP_TOOLS, toolReturnsData } from "../tools/tool-registry";
import { dispatchToolCall } from "../orchestrator/tool-dispatcher";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
}

// The exposable set is precisely the registry's read/data tools. No parallel flag.
export function isReadOnlyDataSource(name: string): boolean {
  return toolReturnsData(name);
}

export function buildMcpToolList(): McpTool[] {
  return MVP_TOOLS.filter((t) => t.returnsData === true).map((t) => ({
    name: t.name,
    description: t.description_en,
    inputSchema: t.parameters,
  }));
}

export type ReadToolResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function callReadTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ReadToolResult> {
  if (!isReadOnlyDataSource(name)) {
    return { ok: false, error: `Unknown or non-exposed tool: ${name}` };
  }
  const result = await dispatchToolCall(name, args, "en");
  if (!result.success) {
    return { ok: false, error: result.error ?? result.message };
  }
  // data is the serialized structured result; message is the human string used
  // when there is no data (e.g. "nothing relevant"). Never re-generate.
  return { ok: true, text: result.data ?? result.message };
}
