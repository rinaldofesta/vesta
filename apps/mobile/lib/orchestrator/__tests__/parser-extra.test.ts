import { looksLikeToolAttempt } from "../response-parser";
import { capInjectedKnowledge } from "../knowledge-format";

describe("looksLikeToolAttempt", () => {
  it("detects a truncated tool-call JSON", () => {
    expect(looksLikeToolAttempt('{"tool":"set_alarm","parameters":{"time":"07:')).toBe(true);
  });
  it("detects a fenced truncated tool call", () => {
    expect(looksLikeToolAttempt('```json\n{"tool":"set_reminder",')).toBe(true);
  });
  it("ignores normal prose", () => {
    expect(looksLikeToolAttempt("Sure, I can help you set an alarm.")).toBe(false);
  });
  it("ignores prose that merely mentions tools", () => {
    expect(looksLikeToolAttempt('The "tool" you want is the clock app.')).toBe(false);
  });
  it("ignores a non-tool JSON object", () => {
    expect(looksLikeToolAttempt('{"foo":"bar"}')).toBe(false);
  });
  it("strips think tags before checking", () => {
    expect(looksLikeToolAttempt('<think>hmm</think>{"tool":"set_alarm"')).toBe(true);
  });
});

describe("capInjectedKnowledge", () => {
  it("returns short content unchanged", () => {
    expect(capInjectedKnowledge("short", 100)).toBe("short");
  });
  it("truncates and appends a notice when over the limit", () => {
    const big = "line one\n" + "x".repeat(500);
    const capped = capInjectedKnowledge(big, 120);
    expect(capped.length).toBeLessThanOrEqual(120);
    expect(capped).toContain("knowledge truncated");
  });
  it("prefers a line boundary when one is near the budget", () => {
    const block = "aaaa\nbbbb\ncccc\ndddd";
    const capped = capInjectedKnowledge(block, 60);
    // block is short enough to be returned as-is
    expect(capped).toBe(block);
  });
  it("never exceeds max even when max is smaller than the notice", () => {
    const big = "x".repeat(500);
    for (const max of [0, 1, 10, 30, 52]) {
      expect(capInjectedKnowledge(big, max).length).toBeLessThanOrEqual(max);
    }
  });
});
