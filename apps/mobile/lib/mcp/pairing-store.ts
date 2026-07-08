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
