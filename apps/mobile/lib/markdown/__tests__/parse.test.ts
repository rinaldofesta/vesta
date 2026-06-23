import { parseInline, parseMarkdown } from "../parse";

describe("parseInline", () => {
  it("plain text", () => {
    expect(parseInline("hello world")).toEqual([{ t: "text", v: "hello world" }]);
  });
  it("bold", () => {
    expect(parseInline("a **b** c")).toEqual([
      { t: "text", v: "a " },
      { t: "bold", children: [{ t: "text", v: "b" }] },
      { t: "text", v: " c" },
    ]);
  });
  it("italic with both markers", () => {
    expect(parseInline("*x* and _y_")).toEqual([
      { t: "italic", children: [{ t: "text", v: "x" }] },
      { t: "text", v: " and " },
      { t: "italic", children: [{ t: "text", v: "y" }] },
    ]);
  });
  it("inline code is literal (no emphasis inside)", () => {
    expect(parseInline("run `a*b*c` now")).toEqual([
      { t: "text", v: "run " },
      { t: "code", v: "a*b*c" },
      { t: "text", v: " now" },
    ]);
  });
  it("bold containing italic", () => {
    expect(parseInline("**a _b_**")).toEqual([
      {
        t: "bold",
        children: [
          { t: "text", v: "a " },
          { t: "italic", children: [{ t: "text", v: "b" }] },
        ],
      },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("headings", () => {
    expect(parseMarkdown("# Title")).toEqual([
      { t: "h", level: 1, inline: [{ t: "text", v: "Title" }] },
    ]);
  });
  it("fenced code block keeps contents verbatim", () => {
    const blocks = parseMarkdown("```js\nconst x = 1;\n```");
    expect(blocks).toEqual([{ t: "code", v: "const x = 1;", lang: "js" }]);
  });
  it("unordered list groups consecutive items", () => {
    const blocks = parseMarkdown("- one\n- two");
    expect(blocks).toEqual([
      {
        t: "ul",
        items: [[{ t: "text", v: "one" }], [{ t: "text", v: "two" }]],
      },
    ]);
  });
  it("ordered list", () => {
    const blocks = parseMarkdown("1. a\n2. b");
    expect(blocks[0].t).toBe("ol");
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(2);
  });
  it("paragraph joins soft-wrapped lines", () => {
    expect(parseMarkdown("hello\nworld")).toEqual([
      { t: "p", inline: [{ t: "text", v: "hello world" }] },
    ]);
  });
  it("separates blocks across blank lines", () => {
    const blocks = parseMarkdown("para one\n\n# Heading\n\n- item");
    expect(blocks.map((b) => b.t)).toEqual(["p", "h", "ul"]);
  });
  it("does not crash on unterminated formatting", () => {
    expect(() => parseMarkdown("**unclosed and `also")).not.toThrow();
  });
});
