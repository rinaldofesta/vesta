# Vesta MCP Server — Design (Fase 6, slice 1)

**Date:** 2026-07-07
**Status:** Approved design → ready for implementation plan
**Phase:** Fase 6 (MCP + Advanced), first slice

## Context

Vesta runs entirely on-device with a set of declarative tools (calendar read,
contacts search, document RAG, alarms/reminders/etc.). The strategic next step
(GAMEPLAN Fase 6) is to expose those tools as a **local MCP server** so an
external agent — Claude Code / Desktop / Cursor on a laptop over the LAN — can
call them, keeping the user's private data on the phone: the agent gets the
*answer* or the *action*, the raw calendar/contacts/documents never leave the
device.

This spec covers the **first slice only**: a LAN-reachable, read-only MCP
server with per-client token auth.

## Goals

- A native HTTP MCP server on the phone, reachable from a laptop MCP client over
  WiFi, exposing **read-only** Vesta tools.
- Per-client named bearer tokens, individually revocable, server OFF by default.
- Reuse the existing tool registry and dispatcher; keep protocol logic in
  TypeScript per Vesta's "minimal native" principle.

## Non-goals (YAGNI for this slice)

- **No action tools** (make_call, send_sms, set_alarm, create_event, etc.) — so
  no remote-action-confirmation UX is designed yet.
- **No mDNS auto-discovery** — the user copies the URL + token from Settings.
- **No TLS** — plain HTTP over the LAN; the bearer token is the perimeter (home-LAN
  threat model). TLS is a later hardening.
- **No SSE / server-initiated notifications** — request/response only.
- **No multi-network, no cloud relay.**

## Verified before design lock

`claude mcp add --transport http <name> <url> --header "Authorization: Bearer <token>"`
is supported by Claude Code (confirmed via `claude mcp add --help`, 2026-07-07).
So the wire format is: a single `POST /mcp` endpoint, JSON-RPC 2.0 body, and a
per-client `Authorization: Bearer <token>` header. This locks the auth surface.

## Architecture

React Native can't serve HTTP from JS, so the server is native — but native
stays a **dumb transport + auth gate**, and TypeScript remains the brain.

```
   Laptop MCP client (Claude Code)
        │  POST /mcp  (Authorization: Bearer <token>)  JSON-RPC 2.0
        ▼
┌─────────────────────────────────────────────────────────────┐
│ NATIVE (Kotlin) — McpHttpServer (NanoHTTPD) in VestaService   │
│  • bind 0.0.0.0:<port> while enabled                          │
│  • auth: match Authorization token against the pairing store  │
│  • forward the raw JSON-RPC body to JS, block on a            │
│    CompletableFuture<Response> keyed by a request id          │
│  • write the JS-produced JSON-RPC response back               │
└───────────────┬──────────────────────────────┬───────────────┘
   emit mcpRequest{id, token, body}   respondMcp(id, status, body)
                ▼                              ▲
┌─────────────────────────────────────────────────────────────┐
│ TYPESCRIPT — MCP engine (lib/mcp/)                            │
│  • JSON-RPC 2.0 parse/dispatch                                │
│  • initialize handshake, tools/list, tools/call              │
│  • tools/list ← tool-registry (mcpExposed filter)            │
│  • tools/call → tool-dispatcher DATA-fetch path (no re-gen)   │
└─────────────────────────────────────────────────────────────┘
```

The token match is done natively (cheap 401 for bad tokens without waking JS),
but the pairing store's source of truth is SQLite; native reads the active token
set (refreshed on change) to gate requests. The JS engine also receives the
token so it can stamp last-seen and enforce per-client scoping if needed.

### Key semantic decision: Vesta returns *data*, not answers

Over MCP the **host agent (Claude) is the reasoner**. Returning prose would force
a double-reason and throw away structure. So `tools/call` reuses the dispatcher's
**data-fetch** but **skips the generative pass** (the orchestrator's query-loop
re-generation that Vesta uses in-app to turn tool data into a spoken answer).

Important precision: *skip generation, not all inference.*
- `get_calendar_events`, `search_contacts` → pure data fetches, **zero inference**.
- `query_document` (next tool, see below) → returns **ranked passages** via the
  existing embedding pass. That's **retrieval, not generation** — the embedding
  step stays; only the answer-writing step is dropped.

## Tools exposed

Selection is driven by a new **`mcpExposed: boolean`** field on `ToolDefinition`
in `lib/tools/tool-registry.ts` — the registry stays the single source of truth,
no hardcoded name list in the MCP layer. The existing `category` /
`confirmRequired` fields don't cleanly separate "exposable data fetch" from
"action", which is why an explicit flag is added.

**MVP core (this slice):**
- `get_calendar_events` — reads the device calendar (already native via
  ContentResolver). Zero inference.
- `search_contacts` — reads contacts by query (already native). Zero inference.

**Designed-in next tool (flag flip once the two above are validated):**
- `query_document` — returns the top-ranked document passages for a query via the
  existing embedding + brute-force-cosine retrieval (`document-retriever`),
  bypassing the grounded re-generation. Retrieval-only. Already built (Fase 3);
  needs only `mcpExposed: true` + a data-only return path. Kept out of the very
  first slice to validate the two zero-inference tools first; trivially added.

Each exposed tool maps to an MCP tool definition: `name`, `description` (English),
and `inputSchema` = the tool's existing JSON-Schema `parameters` (already in that
shape). `tools/call` validates arguments against the same schema before dispatch.

## Components (each a focused unit)

1. **`native/android/.../McpHttpServer.kt`** — NanoHTTPD server. Start/stop, bind
   `0.0.0.0:<port>`, read `Authorization`, 401 on unknown/revoked token, forward
   body to JS, block on `CompletableFuture` per request id, write response.
   Thread-per-request blocking (see concurrency assumption).
2. **`VestaService.kt` change** — owns the server lifecycle; the persistent
   notification shows "MCP server on: http://<lan-ip>:<port>" when enabled.
3. **`McpServerModule.kt` (+ package)** — RN bridge: `startMcpServer(port)`,
   `stopMcpServer()`, `setActiveTokens(list)`, `respondMcp(id, status, body)`,
   and emits the `mcpRequest` device event. Mirrors the existing
   SystemActions/memoryWarning bridge patterns.
4. **`lib/mcp/mcp-server.ts`** — the MCP protocol engine: JSON-RPC 2.0 dispatch,
   `initialize`, `tools/list`, `tools/call`; subscribes to `mcpRequest`, replies
   via `respondMcp`.
5. **`lib/mcp/mcp-tools.ts`** — builds MCP tool defs from the `mcpExposed` registry
   entries; routes `tools/call` to the dispatcher's data-fetch, returning raw
   structured results (no re-generation).
6. **`lib/mcp/pairing-store.ts`** — per-client named tokens (create, list with
   last-seen, revoke). Persisted via a new SQLite migration (`mcp_clients` table:
   id, name, token, created_at, last_seen). Pushes the active token set to native.
7. **`lib/native/mcp-server.ts`** — thin TS wrapper over `McpServerModule`.
8. **`app/mcp.tsx`** + a Settings entry — toggle the server (OFF by default), show
   the URL, add a named client (generates a token to copy), list clients with
   last-seen, revoke.

## Data flow — a `tools/call` request

1. Laptop client `POST /mcp` with `Authorization: Bearer <token>` and a JSON-RPC
   `tools/call` body.
2. `McpHttpServer` checks the token against the active set → 401 if unknown/revoked.
3. Valid → generate `id`, emit `mcpRequest{id, token, body}`, block on
   `futures[id]`.
4. `mcp-server.ts` parses JSON-RPC, routes `tools/call` → `mcp-tools.ts` →
   `dispatchToolCall` (data-fetch path) → structured result; stamps the client's
   last-seen.
5. `mcp-server.ts` calls `respondMcp(id, 200, jsonRpcResult)`.
6. Native completes `futures[id]`, unblocks the HTTP thread, writes the response.

## Pairing & consent (token-issuance-only)

- Server **OFF by default**. Settings → MCP shows the URL when on.
- **"Add client"** → user names it (e.g. "MacBook — Claude Code") → Vesta
  generates a random token and shows the copy-paste command/values. **Issuing the
  token is the consent** — there is deliberately **no first-connect approval
  prompt** (it would be a redundant second gate on an act the user just performed,
  and on plain HTTP it's not a real theft defense).
- Connected clients are listed with **last-seen**; **revoke** deletes the token
  (native token set refreshed → subsequent requests 401). Toggling the server off
  stops everything.

## Security

- Plain HTTP over the LAN; a per-client bearer token is the perimeter. Unknown or
  revoked token → 401 before any data is read.
- Server binds `0.0.0.0:<port>` only while enabled; the notification makes an
  active server visible. Bind-to-a-specific-WiFi-interface is deliberately avoided
  (interface IPs churn on reconnect); Settings shows the current LAN IP and the
  server restarts on meaningful network changes.
- No arguments from the wire reach a shell or SQL string; tool args are validated
  against each tool's JSON-Schema before dispatch.

## Known risks (named, not solved in this slice)

- **Backgrounded JS throttling.** The foreground service keeps the *process*
  alive, but React Native's JS thread can be throttled when the screen is off, so
  an MCP request to a backgrounded app may stall until the app is woken. For the
  "laptop calls the phone on the desk" case this is the most likely real-world
  failure. **Assumption for this slice: Vesta is foregrounded during MCP use, or
  the caller accepts added latency.** If it bites, the fix (a headless JS task, or
  moving tool execution native) is larger than this slice.
- **Interface binding on Android is fiddly.** Handled pragmatically by binding
  `0.0.0.0` + showing the LAN IP + restarting on network change, rather than
  per-interface binding.
- **Concurrency.** Assumes a single client and low concurrency. NanoHTTPD
  thread-per-request blocking on a `CompletableFuture` per id is fine for that and
  is intentionally not built to scale; documented so nobody naively raises the
  concurrency.

## Testing

- **TS unit tests** (jest): `tools/list` shape derived from the `mcpExposed`
  registry entries; `tools/call` routes to the dispatcher and returns data-only
  (no re-generation); JSON-RPC error cases (unknown method, bad params, malformed
  body → proper JSON-RPC error, never a throw); pairing-store issue/list/revoke and
  the active-token-set push; unknown-token rejection logic.
- **On-device**: from the laptop,
  `claude mcp add --transport http vesta http://<phone-ip>:<port>/mcp --header "Authorization: Bearer <token>"`;
  verify `tools/list` returns the exposed tools, call each read tool and confirm
  real device data comes back, then revoke the client and confirm the next call
  401s. (Native HTTP + protocol correctness aren't exercised by CI's debug build,
  so this on-device check is the gate — same pattern as prior Fase device checks.)

## Open decision for review

- **query_document in the MVP or as the immediate follow-on?** The spec puts the
  two zero-inference tools in the first slice and query_document one flag-flip
  later. If you'd rather ship all three at once (it's the strongest privacy use
  case and is already built), we pull it into the MVP — the only extra work is the
  data-only return path for the retriever.
