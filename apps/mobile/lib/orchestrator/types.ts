// Core types for the Vesta orchestrator

export type Language = "it" | "en";

export interface ParsedToolCall {
  tool: string;
  parameters: Record<string, unknown>;
  message?: string;
}

export type OrchestratorResponse =
  | { type: "tool_call"; tool: string; parameters: Record<string, unknown>; message: string; result: ToolCallResult }
  | { type: "pending_tool_call"; tool: string; parameters: Record<string, unknown>; message: string }
  | { type: "text"; content: string }
  | { type: "error"; error: string };

export interface ToolCallResult {
  success: boolean;
  message: string;
  error?: string;
  // For read/query tools (e.g. get_calendar_events, search_contacts): the
  // fetched data, serialized for the model to ground a natural-language answer
  // in. The orchestrator feeds this back for a second generation.
  data?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "tool_result";
  content: string;
  toolCall?: string; // JSON string of ParsedToolCall
  toolResult?: string; // JSON string of ToolCallResult
  modelUsed?: string;
  latencyMs?: number;
  createdAt: number; // Unix timestamp ms
}
