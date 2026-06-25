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

  it("does not gate non-destructive launchers", () => {
    // A countdown timer and opening maps navigation are benign and immediate —
    // forcing a Confirm tap would just add friction.
    expect(toolRequiresConfirmation("set_timer", true)).toBe(false);
    expect(toolRequiresConfirmation("navigate_to", true)).toBe(false);
  });

  it("respects the global setting being off", () => {
    expect(toolRequiresConfirmation("set_alarm", false)).toBe(false);
    expect(toolRequiresConfirmation("create_event", false)).toBe(false);
  });

  it("treats unknown tools as not-gated", () => {
    expect(toolRequiresConfirmation("definitely_not_a_tool", true)).toBe(false);
  });

  it("gates every device-mutating tool (alarm/event/reminder)", () => {
    // Tools that write durable state must stay gated. Non-destructive launchers
    // (set_timer, navigate_to) are intentionally excluded.
    const mutating = ["set_alarm", "create_event", "set_reminder"];
    for (const name of mutating) {
      const t = MVP_TOOLS.find((x) => x.name === name);
      expect(t?.confirmRequired).toBe(true);
    }
  });
});
