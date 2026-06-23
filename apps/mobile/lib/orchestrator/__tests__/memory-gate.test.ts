import { shouldExtractMemory } from "../memory-gate";

describe("shouldExtractMemory", () => {
  it("skips tool-call turns (canned confirmations)", () => {
    expect(shouldExtractMemory("set an alarm for 7:30 tomorrow morning", true)).toBe(false);
  });

  it("skips short greetings / acks", () => {
    expect(shouldExtractMemory("ok", false)).toBe(false);
    expect(shouldExtractMemory("grazie", false)).toBe(false);
    expect(shouldExtractMemory("   ciao   ", false)).toBe(false);
  });

  it("runs on substantive chat turns", () => {
    expect(shouldExtractMemory("I'm vegetarian and I work night shifts", false)).toBe(true);
    expect(shouldExtractMemory("Mio figlio si chiama Marco", false)).toBe(true);
  });
});
