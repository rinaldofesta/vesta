jest.mock("uuid", () => ({ v4: () => "id-1" }));
// virtual: true — Task 4 (native/mcp-server.ts) doesn't exist on this branch yet;
// without this flag Jest's module resolution fails before the factory even runs.
jest.mock("../../native/mcp-server", () => ({ setActiveTokens: jest.fn() }), { virtual: true });
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
