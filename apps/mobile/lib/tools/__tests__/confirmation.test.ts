import { toolRequiresConfirmation, MVP_TOOLS } from "../tool-registry";

describe("toolRequiresConfirmation", () => {
  it("gates the three device-mutating tools when confirmation is enabled", () => {
    expect(toolRequiresConfirmation("set_alarm", true)).toBe(true);
    expect(toolRequiresConfirmation("create_event", true)).toBe(true);
    expect(toolRequiresConfirmation("set_reminder", true)).toBe(true);
  });

  it("never gates pure conversation", () => {
    expect(toolRequiresConfirmation("general_chat", true)).toBe(false);
  });

  it("respects the global setting being off", () => {
    expect(toolRequiresConfirmation("set_alarm", false)).toBe(false);
    expect(toolRequiresConfirmation("create_event", false)).toBe(false);
  });

  it("treats unknown tools as not-gated", () => {
    expect(toolRequiresConfirmation("definitely_not_a_tool", true)).toBe(false);
  });

  it("keeps every system_action tool marked confirmRequired", () => {
    for (const t of MVP_TOOLS) {
      if (t.category === "system_action") {
        expect(t.confirmRequired).toBe(true);
      }
    }
  });
});
