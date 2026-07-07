# Vesta MCP Server (Fase 6, slice 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Vesta's three read-only tools (`get_calendar_events`, `search_contacts`, `query_document`) as a LAN-reachable MCP server so a laptop agent (Claude Code/Desktop) can call them, with the private data staying on the phone.

**Architecture:** Native Kotlin (NanoHTTPD in `VestaService`) is a dumb transport + auth gate that forwards raw JSON-RPC bodies to JS and blocks on a `CompletableFuture` per request id; a TypeScript MCP engine (`lib/mcp/`) handles JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`), reusing the existing `tool-registry` (`returnsData` predicate) and `tool-dispatcher` (data-only path, skipping the orchestrator's generative query-loop). Per-client bearer tokens are owned in SQLite by TS and pushed into native memory.

**Tech Stack:** React Native 0.83 (New Arch/bridgeless), Expo SDK 55, Kotlin, NanoHTTPD, expo-sqlite, jest-expo. Design spec: `docs/superpowers/specs/2026-07-07-vesta-mcp-server-design.md`.

## Global Constraints

- **Package:** `com.cosmico.vesta`. Kotlin lives in `apps/mobile/native/android/src/main/java/com/cosmico/vesta/`; the `with-system-actions` plugin copies it into `android/` at prebuild.
- **Bridge pattern:** mirror the `memoryWarning` bridge (native `reactApplicationContext.emitDeviceEvent(name, data)` guarded by `hasActiveReactInstance()`, JS `NativeEventEmitter(NativeModules.<Module>)`; `@ReactMethod addListener(name)`/`removeListeners(count)` no-ops on the module). New Arch: `console.log` does NOT reach logcat — use `android.util.Log` for native debugging.
- **Data-not-answers:** MCP `tools/call` returns `ToolCallResult.data` (the serialized structured result); it NEVER runs the orchestrator's re-generation query-loop.
- **Read-only set:** exactly the `returnsData: true` tools. No new `mcpExposed` flag.
- **Consent:** token-issuance-only. No first-connect approval.
- **Transport:** minimal Streamable HTTP — `POST /mcp`, JSON-RPC 2.0, no SSE, no server-initiated notifications.
- **Concurrency:** single client, low concurrency (thread-per-request blocking on a `CompletableFuture` is intentionally not built to scale).
- **Tests:** `cd apps/mobile && npm test` (jest-expo). `jest.mock("uuid", () => ({ v4: () => "test-uuid" }))` when a module pulls in uuid. Branch: `fase6-mcp-server`.
- **Server default:** OFF. Bind `0.0.0.0`; Settings shows the LAN IP.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/mcp/mcp-tools.ts` | Read-only predicate + MCP tool-def list from registry + `tools/call` data path |
| `lib/mcp/mcp-server.ts` | JSON-RPC 2.0 engine: `initialize`, `tools/list`, `tools/call`, errors |
| `lib/mcp/pairing-store.ts` | SQLite-backed per-client tokens: create/list/touch/revoke/getActiveTokens |
| `lib/native/mcp-server.ts` | TS wrapper over the native module + event wiring |
| `lib/storage/database.ts` | Migration v3: `mcp_clients` table (modify) |
| `native/android/.../McpHttpServer.kt` | NanoHTTPD server: bind, auth, forward, respond |
| `native/android/.../McpServerModule.kt` | RN bridge: start/stop/setActiveTokens/respondMcp + event |
| `native/android/.../SystemActionsPackage.kt` | Register `McpServerModule` (modify) |
| `native/android/.../VestaService.kt` | Start/stop server with lifecycle + notification (modify) |
| `plugins/with-system-actions.js` | NanoHTTPD Gradle dep (modify) |
| `app/mcp.tsx` | MCP settings screen: toggle, clients, URL |
| `app/settings.tsx` | Entry row → `/mcp` (modify) |
| `app/_layout.tsx` | Register `mcp` Stack screen (modify) |

**Intentional lazy import cycle:** `pairing-store` → `native/mcp-server` (push tokens) → `mcp/mcp-server` (handle request) → `pairing-store` (touch). This is safe because every cross-module reference is used *inside a function*, never at module-init — the cycle resolves at call time. Per-task tests mock these deps, so task order doesn't matter for the TDD steps; the full typecheck (Task 8) runs only after all files exist. Do not try to "fix" the cycle by hoisting imports to the top-level of a call.

---

## Task 1: MCP tool layer (`lib/mcp/mcp-tools.ts`)

**Files:**
- Create: `apps/mobile/lib/mcp/mcp-tools.ts`
- Test: `apps/mobile/lib/mcp/__tests__/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `MVP_TOOLS`, `toolReturnsData` from `../tools/tool-registry`; `dispatchToolCall` from `../orchestrator/tool-dispatcher`; `ToolCallResult` from `../orchestrator/types`.
- Produces:
  - `type McpTool = { name: string; description: string; inputSchema: object }`
  - `buildMcpToolList(): McpTool[]` — the `returnsData` tools as MCP defs.
  - `isReadOnlyDataSource(name: string): boolean`
  - `callReadTool(name: string, args: Record<string, unknown>): Promise<{ ok: true; text: string } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/lib/mcp/__tests__/mcp-tools.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx jest lib/mcp/__tests__/mcp-tools.test.ts`
Expected: FAIL — cannot find module `../mcp-tools`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/lib/mcp/mcp-tools.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && npx jest lib/mcp/__tests__/mcp-tools.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/mcp/mcp-tools.ts apps/mobile/lib/mcp/__tests__/mcp-tools.test.ts
git commit -m "feat(mcp): tool-def list + data-only tools/call path from the registry"
```

---

## Task 2: Pairing store + migration v3 (`lib/mcp/pairing-store.ts`)

**Files:**
- Modify: `apps/mobile/lib/storage/database.ts` (add migration v3 + CRUD helpers)
- Create: `apps/mobile/lib/mcp/pairing-store.ts`
- Test: `apps/mobile/lib/mcp/__tests__/pairing-store.test.ts`

**Interfaces:**
- Consumes: `getDatabase` from `../storage/database`; `setActiveTokens` from `../native/mcp-server` (Task 4 — mock it in tests).
- Produces:
  - `interface McpClient { id: string; name: string; token: string; createdAt: number; lastSeen: number | null }`
  - `createClient(name: string): Promise<McpClient>` — random token, persists, pushes active set.
  - `listClients(): Promise<McpClient[]>`
  - `revokeClient(id: string): Promise<void>` — deletes, pushes active set.
  - `touch(token: string): Promise<void>` — updates last_seen.
  - `getActiveTokens(): Promise<string[]>`
  - `pushActiveTokens(): Promise<void>` — reads tokens, calls native `setActiveTokens`.

- [ ] **Step 1: Add migration v3 + row helpers in `database.ts`**

Add to the `MIGRATIONS` array (after the version-2 object; the migration runner is already tested by `migrations.test.ts`):

```ts
  {
    // Fase 6 (MCP): per-client bearer tokens for the local MCP server. Owned
    // here in TS; the native HTTP server only ever sees an in-memory copy.
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS mcp_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen INTEGER
      );
    `,
  },
```

Add these exported helpers at the end of `database.ts`:

```ts
export interface McpClientRow {
  id: string;
  name: string;
  token: string;
  created_at: number;
  last_seen: number | null;
}

export async function insertMcpClient(row: McpClientRow): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO mcp_clients (id, name, token, created_at, last_seen) VALUES (?, ?, ?, ?, ?)",
    [row.id, row.name, row.token, row.created_at, row.last_seen],
  );
}

export async function selectMcpClients(): Promise<McpClientRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<McpClientRow>(
    "SELECT id, name, token, created_at, last_seen FROM mcp_clients ORDER BY created_at DESC",
  );
}

export async function deleteMcpClient(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM mcp_clients WHERE id = ?", [id]);
}

export async function touchMcpClient(token: string, at: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("UPDATE mcp_clients SET last_seen = ? WHERE token = ?", [at, token]);
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/mobile/lib/mcp/__tests__/pairing-store.test.ts
jest.mock("uuid", () => ({ v4: () => "id-1" }));
jest.mock("../../native/mcp-server", () => ({ setActiveTokens: jest.fn() }));
jest.mock("../../storage/database", () => ({
  insertMcpClient: jest.fn(async () => {}),
  selectMcpClients: jest.fn(async () => []),
  deleteMcpClient: jest.fn(async () => {}),
  touchMcpClient: jest.fn(async () => {}),
}));
import * as db from "../../storage/database";
import { setActiveTokens } from "../../native/mcp-server";
import { createClient, listClients, revokeClient, touch, getActiveTokens } from "../pairing-store";

const mockSetActive = setActiveTokens as jest.MockedFunction<typeof setActiveTokens>;

beforeEach(() => jest.clearAllMocks());

it("createClient generates a token, persists, and pushes the active set", async () => {
  (db.selectMcpClients as jest.Mock).mockResolvedValue([
    { id: "id-1", name: "MacBook", token: "tok-abc", created_at: 1, last_seen: null },
  ]);
  const client = await createClient("MacBook");
  expect(client.name).toBe("MacBook");
  expect(client.token.length).toBeGreaterThanOrEqual(32);
  expect(db.insertMcpClient).toHaveBeenCalledTimes(1);
  expect(mockSetActive).toHaveBeenCalledWith(["tok-abc"]);
});

it("revokeClient deletes and re-pushes the (now empty) active set", async () => {
  (db.selectMcpClients as jest.Mock).mockResolvedValue([]);
  await revokeClient("id-1");
  expect(db.deleteMcpClient).toHaveBeenCalledWith("id-1");
  expect(mockSetActive).toHaveBeenCalledWith([]);
});

it("getActiveTokens maps rows to tokens", async () => {
  (db.selectMcpClients as jest.Mock).mockResolvedValue([
    { id: "a", name: "x", token: "t1", created_at: 1, last_seen: null },
    { id: "b", name: "y", token: "t2", created_at: 2, last_seen: null },
  ]);
  expect(await getActiveTokens()).toEqual(["t1", "t2"]);
});

it("touch delegates to the row helper", async () => {
  await touch("t1");
  expect(db.touchMcpClient).toHaveBeenCalledWith("t1", expect.any(Number));
});

it("listClients maps rows to camelCase clients", async () => {
  (db.selectMcpClients as jest.Mock).mockResolvedValue([
    { id: "a", name: "x", token: "t1", created_at: 5, last_seen: 9 },
  ]);
  expect(await listClients()).toEqual([
    { id: "a", name: "x", token: "t1", createdAt: 5, lastSeen: 9 },
  ]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/mobile && npx jest lib/mcp/__tests__/pairing-store.test.ts`
Expected: FAIL — cannot find module `../pairing-store`.

- [ ] **Step 4: Write the implementation**

```ts
// apps/mobile/lib/mcp/pairing-store.ts
// Single owner of per-client MCP tokens. Persists in SQLite (TS-owned) and
// pushes the active token set into the native server's in-memory set; the
// native side never opens the DB.

import { v4 as uuid } from "uuid";
import {
  insertMcpClient,
  selectMcpClients,
  deleteMcpClient,
  touchMcpClient,
} from "../storage/database";
import { setActiveTokens } from "../native/mcp-server";

export interface McpClient {
  id: string;
  name: string;
  token: string;
  createdAt: number;
  lastSeen: number | null;
}

// URL-safe random token. Not a session secret vs a global adversary — it gates
// LAN access, and revocation is instant. ~192 bits from 24 bytes hex.
function generateToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getActiveTokens(): Promise<string[]> {
  const rows = await selectMcpClients();
  return rows.map((r) => r.token);
}

export async function pushActiveTokens(): Promise<void> {
  await setActiveTokens(await getActiveTokens());
}

export async function createClient(name: string): Promise<McpClient> {
  const client: McpClient = {
    id: uuid(),
    name,
    token: generateToken(),
    createdAt: Date.now(),
    lastSeen: null,
  };
  await insertMcpClient({
    id: client.id,
    name: client.name,
    token: client.token,
    created_at: client.createdAt,
    last_seen: null,
  });
  await pushActiveTokens();
  return client;
}

export async function listClients(): Promise<McpClient[]> {
  const rows = await selectMcpClients();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    token: r.token,
    createdAt: r.created_at,
    lastSeen: r.last_seen,
  }));
}

export async function revokeClient(id: string): Promise<void> {
  await deleteMcpClient(id);
  await pushActiveTokens();
}

export async function touch(token: string): Promise<void> {
  await touchMcpClient(token, Date.now());
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/mobile && npx jest lib/mcp/__tests__/pairing-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/storage/database.ts apps/mobile/lib/mcp/pairing-store.ts apps/mobile/lib/mcp/__tests__/pairing-store.test.ts
git commit -m "feat(mcp): migration v3 + pairing store (TS-owned tokens, active-set push)"
```

---

## Task 3: MCP protocol engine (`lib/mcp/mcp-server.ts`)

**Files:**
- Create: `apps/mobile/lib/mcp/mcp-server.ts`
- Test: `apps/mobile/lib/mcp/__tests__/mcp-server.test.ts`

**Interfaces:**
- Consumes: `buildMcpToolList`, `callReadTool` from `./mcp-tools`; `touch` from `./pairing-store`.
- Produces: `handleJsonRpc(bodyText: string, token: string): Promise<string>` — takes a raw request body + the authenticated token, returns the JSON-RPC response body (string). Never throws.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/lib/mcp/__tests__/mcp-server.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx jest lib/mcp/__tests__/mcp-server.test.ts`
Expected: FAIL — cannot find module `../mcp-server`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/lib/mcp/mcp-server.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/mobile && npx jest lib/mcp/__tests__/mcp-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/mcp/mcp-server.ts apps/mobile/lib/mcp/__tests__/mcp-server.test.ts
git commit -m "feat(mcp): JSON-RPC engine (initialize, tools/list, tools/call, errors)"
```

---

## Task 4: TS native bridge (`lib/native/mcp-server.ts`)

**Files:**
- Create: `apps/mobile/lib/native/mcp-server.ts`
- Test: `apps/mobile/lib/native/__tests__/mcp-server.test.ts`

**Interfaces:**
- Consumes: `NativeModules.McpServerModule`, `NativeEventEmitter` (react-native); `handleJsonRpc` from `../mcp/mcp-server`.
- Produces:
  - `startMcpServer(port: number): Promise<{ ip: string; port: number }>`
  - `stopMcpServer(): Promise<void>`
  - `setActiveTokens(tokens: string[]): void`
  - `installMcpRequestListener(): () => void` — subscribes to the native `mcpRequest` event, runs `handleJsonRpc`, calls native `respondMcp(id, 200, body)`; returns an unsubscribe fn.

The native module contract (implemented in Task 5):
- `startServer(port): Promise<string>` (resolves the LAN IP), `stopServer(): Promise<void>`, `setActiveTokens(tokens: string[]): void`, `respondMcp(id: string, status: number, body: string): void`, and emits `mcpRequest` with `{ id, token, body }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/lib/native/__tests__/mcp-server.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx jest lib/native/__tests__/mcp-server.test.ts`
Expected: FAIL — cannot find module `../mcp-server`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/lib/native/mcp-server.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/mobile && npx jest lib/native/__tests__/mcp-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/native/mcp-server.ts apps/mobile/lib/native/__tests__/mcp-server.test.ts
git commit -m "feat(mcp): TS native bridge — start/stop/tokens + request→respond wiring"
```

---

## Task 5: Native HTTP server + module (Kotlin)

**Files:**
- Create: `apps/mobile/native/android/src/main/java/com/cosmico/vesta/McpHttpServer.kt`
- Create: `apps/mobile/native/android/src/main/java/com/cosmico/vesta/McpServerModule.kt`
- Modify: `apps/mobile/native/android/src/main/java/com/cosmico/vesta/SystemActionsPackage.kt`

**Interfaces:**
- Produces the native module contract consumed by Task 4: `startServer`, `stopServer`, `setActiveTokens`, `respondMcp`, and the `mcpRequest` event `{ id, token, body }`.

No jest for native — the gate is the Android build (Task 6) + the on-device check (Task 9).

- [ ] **Step 1: Write `McpHttpServer.kt`**

```kotlin
package com.cosmico.vesta

import android.util.Log
import fi.iki.elonen.NanoHTTPD
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

// Dumb transport + auth gate. Terminates HTTP, checks the bearer token against
// an in-memory active set (pushed from TS — never opens the DB), forwards the
// raw JSON-RPC body to JS, and blocks the request thread on a future keyed by a
// per-request id until JS calls back with the response. Single-client, low
// concurrency by design.
class McpHttpServer(
    port: Int,
    private val activeTokens: () -> Set<String>,
    private val onRequest: (id: String, token: String, body: String) -> Unit,
) : NanoHTTPD("0.0.0.0", port) {

    private val pending = ConcurrentHashMap<String, CompletableFuture<Pair<Int, String>>>()
    private var counter = 0L

    fun complete(id: String, status: Int, body: String) {
        pending.remove(id)?.complete(status to body)
    }

    override fun serve(session: IHTTPSession): Response {
        if (session.method != Method.POST || session.uri != "/mcp") {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
        }
        val auth = session.headers["authorization"] ?: ""
        val token = auth.removePrefix("Bearer ").trim()
        if (token.isEmpty() || token !in activeTokens()) {
            return newFixedLengthResponse(Response.Status.UNAUTHORIZED, "application/json",
                "{\"error\":\"unauthorized\"}")
        }

        val body = readBody(session)
        val id = synchronized(this) { "req-${counter++}" }
        val future = CompletableFuture<Pair<Int, String>>()
        pending[id] = future
        onRequest(id, token, body)

        return try {
            val (status, respBody) = future.get(30, TimeUnit.SECONDS)
            val nanoStatus = if (status == 200) Response.Status.OK else Response.Status.INTERNAL_ERROR
            // MCP notifications return an empty body → 202 Accepted, no content.
            if (respBody.isEmpty()) {
                newFixedLengthResponse(Response.Status.ACCEPTED, "application/json", "")
            } else {
                newFixedLengthResponse(nanoStatus, "application/json", respBody)
            }
        } catch (e: Exception) {
            pending.remove(id)
            Log.w("McpHttpServer", "request $id timed out or failed", e)
            newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json",
                "{\"error\":\"timeout\"}")
        }
    }

    private fun readBody(session: IHTTPSession): String {
        val map = HashMap<String, String>()
        session.parseBody(map)
        return map["postData"] ?: ""
    }
}
```

- [ ] **Step 2: Write `McpServerModule.kt`**

```kotlin
package com.cosmico.vesta

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.net.Inet4Address
import java.net.NetworkInterface

class McpServerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "McpServerModule"

    @Volatile private var activeTokens: Set<String> = emptySet()
    private var server: McpHttpServer? = null

    @ReactMethod
    fun setActiveTokens(tokens: ReadableArray) {
        val set = HashSet<String>()
        for (i in 0 until tokens.size()) tokens.getString(i)?.let { set.add(it) }
        activeTokens = set
    }

    @ReactMethod
    fun startServer(port: Int, promise: Promise) {
        try {
            if (server != null) { promise.resolve(lanIp()); return }
            val s = McpHttpServer(port, { activeTokens }, ::emitRequest)
            s.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            server = s
            promise.resolve(lanIp())
        } catch (e: Exception) {
            promise.reject("MCP_START_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopServer(promise: Promise) {
        server?.stop()
        server = null
        promise.resolve(null)
    }

    @ReactMethod
    fun respondMcp(id: String, status: Int, body: String) {
        server?.complete(id, status, body)
    }

    // NativeEventEmitter contract.
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    private fun emitRequest(id: String, token: String, body: String) {
        if (!reactApplicationContext.hasActiveReactInstance()) return
        val map = com.facebook.react.bridge.Arguments.createMap()
        map.putString("id", id)
        map.putString("token", token)
        map.putString("body", body)
        reactApplicationContext.emitDeviceEvent("mcpRequest", map)
    }

    private fun lanIp(): String {
        for (nif in NetworkInterface.getNetworkInterfaces()) {
            if (!nif.isUp || nif.isLoopback) continue
            for (addr in nif.inetAddresses) {
                if (addr is Inet4Address && !addr.isLoopbackAddress) return addr.hostAddress ?: ""
            }
        }
        return ""
    }
}
```

Note: `NanoHTTPD.SOCKET_READ_TIMEOUT` and `emitDeviceEvent` match the versions used elsewhere (`SystemActionsModule` uses `emitDeviceEvent`). Import `fi.iki.elonen.NanoHTTPD` for the constant.

- [ ] **Step 3: Register the module in `SystemActionsPackage.kt`**

Change the `createNativeModules` return to include the new module:

```kotlin
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(
            SystemActionsModule(reactContext),
            VestaServiceModule(reactContext),
            McpServerModule(reactContext),
        )
    }
```

- [ ] **Step 4: Commit** (build verification happens in Task 6)

```bash
git add apps/mobile/native/android/src/main/java/com/cosmico/vesta/McpHttpServer.kt \
        apps/mobile/native/android/src/main/java/com/cosmico/vesta/McpServerModule.kt \
        apps/mobile/native/android/src/main/java/com/cosmico/vesta/SystemActionsPackage.kt
git commit -m "feat(mcp): native NanoHTTPD server + RN module (auth gate + future bridge)"
```

---

## Task 6: Add the NanoHTTPD dependency via the config plugin

**Files:**
- Modify: `apps/mobile/plugins/with-system-actions.js`

**Interfaces:** none (build wiring). The gate is a successful `assembleDebug`.

- [ ] **Step 1: Add a `withAppBuildGradle` mod to inject the NanoHTTPD dependency**

At the top of `with-system-actions.js`, extend the import:

```js
const { withMainApplication, withDangerousMod, withAndroidManifest, withAppBuildGradle } = require("expo/config-plugins");
```

Add this function and call it in the exported plugin chain (after the existing mods, before `return config`):

```js
function withNanoHttpd(config) {
  return withAppBuildGradle(config, (cfg) => {
    const dep = `    implementation("org.nanohttpd:nanohttpd:2.3.1")`;
    if (!cfg.modResults.contents.includes("org.nanohttpd:nanohttpd")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        (m) => `${m}\n${dep}`,
      );
    }
    return cfg;
  });
}
```

Wire it in (find where the plugin composes mods and returns `config`):

```js
  config = withNanoHttpd(config);
```

- [ ] **Step 2: Prebuild and verify the dependency + Kotlin land**

```bash
cd apps/mobile
JAVA_HOME=/opt/homebrew/opt/openjdk@17 npx expo prebuild --platform android --clean
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
grep nanohttpd android/app/build.gradle
ls android/app/src/main/java/com/cosmico/vesta/McpHttpServer.kt
```
Expected: the `implementation("org.nanohttpd:nanohttpd:2.3.1")` line present; the Kotlin file copied.

- [ ] **Step 3: Build the debug APK to confirm the native layer compiles**

Run: `cd apps/mobile/android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug --no-daemon`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/plugins/with-system-actions.js
git commit -m "build(mcp): add NanoHTTPD dependency via the config plugin"
```

---

## Task 7: Server lifecycle (start/stop + notification)

**Files:**
- Create: `apps/mobile/lib/mcp/mcp-lifecycle.ts`
- Test: `apps/mobile/lib/mcp/__tests__/mcp-lifecycle.test.ts`
- Modify: `apps/mobile/lib/storage/database.ts` (config seed — reuse existing `getConfig`/`setConfig`)

**Interfaces:**
- Consumes: `startMcpServer`, `stopMcpServer`, `installMcpRequestListener` from `../native/mcp-server`; `pushActiveTokens` from `./pairing-store`; `getConfig`, `setConfig` from `../storage/database`.
- Produces:
  - `enableMcpServer(): Promise<{ ip: string; port: number }>` — installs the listener, pushes tokens, starts the server, persists `mcp_enabled=true`.
  - `disableMcpServer(): Promise<void>` — stops, removes the listener, persists `mcp_enabled=false`.
  - `isMcpEnabled(): Promise<boolean>`
  - `MCP_PORT = 8420`

The `ConnectivityManager.NetworkCallback` restart-on-network-change is a native follow-up noted in the spec; for this slice the server rebinds on the next `enableMcpServer()` and the Settings screen shows the current IP (re-fetched on focus). Document this in the screen (Task 8).

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/lib/mcp/__tests__/mcp-lifecycle.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx jest lib/mcp/__tests__/mcp-lifecycle.test.ts`
Expected: FAIL — cannot find module `../mcp-lifecycle`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/lib/mcp/mcp-lifecycle.ts
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
  if (!removeListener) removeListener = installMcpRequestListener();
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
```

- [ ] **Step 4: Run tests + full suite to verify no regressions**

Run: `cd apps/mobile && npx jest lib/mcp/__tests__/mcp-lifecycle.test.ts && npm test`
Expected: new suite PASS; full suite green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/mcp/mcp-lifecycle.ts apps/mobile/lib/mcp/__tests__/mcp-lifecycle.test.ts
git commit -m "feat(mcp): enable/disable lifecycle with persisted state"
```

---

## Task 8: MCP Settings screen (`app/mcp.tsx`)

**Files:**
- Create: `apps/mobile/app/mcp.tsx`
- Modify: `apps/mobile/app/_layout.tsx` (register the `mcp` Stack screen)
- Modify: `apps/mobile/app/settings.tsx` (add an "MCP server" row → `/mcp`)

**Interfaces:**
- Consumes: `enableMcpServer`, `disableMcpServer`, `isMcpEnabled`, `MCP_PORT` from `../lib/mcp/mcp-lifecycle`; `createClient`, `listClients`, `revokeClient`, `type McpClient` from `../lib/mcp/pairing-store`; theme + `NoticeBanner` patterns already in the repo.

No jest (UI); verified on device in Task 9. Follow the visual conventions of `app/diagnostics.tsx` (ScrollView, `sectionTitle`, `card`, `Row`) and `app/settings.tsx` (`Alert`, primary buttons).

- [ ] **Step 1: Register the screen** in `app/_layout.tsx` — add after the `diagnostics` Stack.Screen:

```tsx
        <Stack.Screen name="mcp" options={{ title: "MCP Server" }} />
```

- [ ] **Step 2: Add the entry row** in `app/settings.tsx` — a new section before "About" (mirrors the Diagnostics row):

```tsx
      <Text style={styles.sectionTitle}>MCP Server</Text>
      <View style={styles.card}>
        <Text style={styles.knowledgeDesc}>
          Let a laptop agent (Claude Code / Desktop) call Vesta&apos;s read tools
          over your Wi-Fi. Your data stays on the phone.
        </Text>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, styles.knowledgeAddBtn]}
          onPress={() => router.push("/mcp")}
          activeOpacity={0.8}
        >
          <Text style={styles.btnPrimaryText}>Configure MCP</Text>
        </TouchableOpacity>
      </View>
```

- [ ] **Step 3: Write `app/mcp.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  ScrollView, View, Text, TextInput, TouchableOpacity, Switch, Alert, StyleSheet,
} from "react-native";
import {
  enableMcpServer, disableMcpServer, isMcpEnabled, MCP_PORT,
} from "../lib/mcp/mcp-lifecycle";
import {
  createClient, listClients, revokeClient, type McpClient,
} from "../lib/mcp/pairing-store";
import { colors, spacing, typography, radii } from "../lib/theme";

export default function McpScreen() {
  const [enabled, setEnabled] = useState(false);
  const [ip, setIp] = useState<string | null>(null);
  const [clients, setClients] = useState<McpClient[]>([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  const refresh = useCallback(() => {
    isMcpEnabled().then(setEnabled).catch(() => {});
    listClients().then(setClients).catch(() => setClients([]));
  }, []);
  useEffect(refresh, [refresh]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        const res = await enableMcpServer();
        setIp(res.ip);
      } else {
        await disableMcpServer();
        setIp(null);
      }
      setEnabled(on);
    } catch (e) {
      Alert.alert("MCP", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addClient = async () => {
    const name = newName.trim();
    if (!name) return;
    const c = await createClient(name);
    setNewName("");
    setClients(await listClients());
    const url = ip ? `http://${ip}:${MCP_PORT}/mcp` : `http://<phone-ip>:${MCP_PORT}/mcp`;
    Alert.alert(
      c.name,
      `Add to your MCP client:\n\nclaude mcp add --transport http vesta ${url} --header "Authorization: Bearer ${c.token}"`,
    );
  };

  const revoke = (c: McpClient) =>
    Alert.alert("Revoke", `Revoke "${c.name}"? Its token stops working immediately.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: async () => { await revokeClient(c.id); setClients(await listClients()); } },
    ]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Server</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Enabled</Text>
          <Switch value={enabled} onValueChange={toggle} disabled={busy}
            trackColor={{ false: colors.disabled, true: colors.accent }} />
        </View>
        {enabled && (
          <Text style={styles.hint}>
            {ip ? `http://${ip}:${MCP_PORT}/mcp` : "Getting LAN address…"}
            {"\n"}Only reachable on this Wi-Fi. Data stays on the phone.
          </Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Clients</Text>
      <View style={styles.card}>
        {clients.length === 0 && <Text style={styles.hint}>No clients yet.</Text>}
        {clients.map((c) => (
          <View key={c.id} style={styles.row}>
            <Text style={styles.label} numberOfLines={1}>{c.name}</Text>
            <TouchableOpacity onPress={() => revoke(c)}>
              <Text style={styles.revoke}>Revoke</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="Name this client (e.g. MacBook — Claude Code)"
          placeholderTextColor={colors.textPlaceholder}
        />
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={addClient} activeOpacity={0.8} disabled={!newName.trim()}>
          <Text style={styles.btnPrimaryText}>Add client</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionTitle: { ...typography.sectionTitle, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.md },
  label: { ...typography.body, color: colors.textPrimary, flexShrink: 1 },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  revoke: { ...typography.body, color: colors.error, fontWeight: "600" },
  input: { ...typography.body, color: colors.textPrimary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.md },
  btn: { borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { ...typography.button, color: colors.userText },
});
```

Note: client naming uses an inline `TextInput` (not `Alert.prompt`, which is iOS-only — the test device is Android). The generated `claude mcp add …` string is shown once via `Alert.alert` after creation so the token is copyable; it is never persisted in the UI.

- [ ] **Step 4: Typecheck + lint + full test suite**

Run: `cd apps/mobile && npm run typecheck && npm run lint && npm test`
Expected: typecheck clean; no new lint errors; tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/mcp.tsx apps/mobile/app/_layout.tsx apps/mobile/app/settings.tsx
git commit -m "feat(mcp): Settings → MCP screen (toggle, clients, pairing command)"
```

---

## Task 9: On-device verification gate

**Files:** none (verification only). This is the gate the design names: native HTTP + protocol correctness aren't exercised by CI.

- [ ] **Step 1: Build + install on the Pixel**

```bash
cd apps/mobile/android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew installDebug --no-daemon
```
Then launch (Metro on 8082 per the device-workflow memory):
```bash
adb shell am start -a android.intent.action.VIEW -d "exp+vesta://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"
```

- [ ] **Step 2: Enable the server + create a client**

In the app: Settings → MCP Server → Configure MCP → toggle Enabled (note the `http://<ip>:8420/mcp` URL) → Add client "Laptop" → copy the generated token.

- [ ] **Step 3: Connect from the laptop and exercise the tools**

Laptop must be on the same Wi-Fi as the phone.
```bash
claude mcp add --transport http vesta http://<phone-ip>:8420/mcp --header "Authorization: Bearer <token>"
claude mcp list          # shows vesta connected
```
In a Claude session, confirm `tools/list` shows the three tools, then call each:
- `get_calendar_events` for a date with events → returns event data.
- `search_contacts` for a known name → returns matches.
- `query_document` for a term in an imported document → returns ranked passages (NOT a generated prose answer — verify it's the raw retrieval data).

- [ ] **Step 4: Verify auth + revoke**

- A request with a wrong/absent token → 401 (test with `curl -s -o /dev/null -w "%{http_code}" http://<phone-ip>:8420/mcp -X POST` → `401`).
- In the app, Revoke "Laptop" → the next `claude` call to a vesta tool fails (401).

- [ ] **Step 5: Record the verification in the docs**

Update `docs/GAMEPLAN.md` (Fase 6 section) with the measured result (tools reachable, data-not-answers confirmed, revoke works), mirroring how prior Fase device checks were recorded. Commit.

```bash
git add docs/GAMEPLAN.md
git commit -m "docs(mcp): record on-device MCP verification"
```

---

## Self-review notes (coverage against the spec)

- Data-not-answers → Task 1 `callReadTool` returns `ToolCallResult.data`; Task 3 wraps as `content:[{type:"text"}]`; never invokes the orchestrator. ✓
- returnsData predicate (no new flag) → Task 1 `isReadOnlyDataSource`/`buildMcpToolList`. ✓
- TS owns tokens, native in-memory only → Task 2 pushes via `setActiveTokens`; Task 5 module holds `activeTokens` set, never opens the DB. ✓
- token-issuance-only consent → Task 8 add/revoke, no first-connect approval. ✓
- Minimal Streamable HTTP (POST /mcp, JSON-RPC, no SSE) → Task 5 `serve` gate; Task 3 engine. ✓
- Bearer header (verified) → Task 5 `Authorization: Bearer` parse. ✓
- Bind 0.0.0.0 + show LAN IP → Task 5 constructor + `lanIp()`; Task 8 displays it. ✓
- Single-client concurrency (thread-per-request + future) → Task 5 `pending` map. ✓
- Risks named (JS throttling, network-change rebind) → carried from spec; rebind-on-enable + IP refresh in Task 7/8; NetworkCallback is an explicit follow-up.
- On-device gate → Task 9. ✓

**Follow-ups explicitly out of this slice (from the spec):** action tools + remote-confirm UX, mDNS discovery, TLS, `ConnectivityManager.NetworkCallback` auto-restart, headless-JS for backgrounded requests.
