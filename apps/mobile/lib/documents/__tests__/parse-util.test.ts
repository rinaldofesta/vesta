import {
  classifyDocument,
  docxXmlToText,
  base64ToBytes,
  decodeXmlEntities,
} from "../parse-util";

describe("classifyDocument", () => {
  it("classifies by extension (case-insensitive)", () => {
    expect(classifyDocument("a.txt")).toBe("txt");
    expect(classifyDocument("notes.md")).toBe("md");
    expect(classifyDocument("a.MARKDOWN")).toBe("md");
    expect(classifyDocument("cv.docx")).toBe("docx");
    expect(classifyDocument("report.PDF")).toBe("pdf");
  });

  it("falls back to mime when the extension is unhelpful", () => {
    expect(classifyDocument("blob", "application/pdf")).toBe("pdf");
    expect(classifyDocument("blob", "text/plain")).toBe("txt");
    expect(
      classifyDocument(
        "blob",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("docx");
  });

  it("returns null for unsupported types", () => {
    expect(classifyDocument("a.xyz")).toBeNull();
    expect(classifyDocument("a.png", "image/png")).toBeNull();
  });
});

describe("docxXmlToText", () => {
  it("extracts paragraph text, decodes entities, drops tags", () => {
    const xml =
      "<w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>Second line</w:t></w:r></w:p>";
    const text = docxXmlToText(xml);
    expect(text).toContain("Hello & welcome");
    expect(text).toContain("Second line");
    expect(text).not.toContain("<w:");
    // Two paragraphs → a blank line between them.
    expect(text.split("\n\n")).toHaveLength(2);
  });
});

describe("decodeXmlEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeXmlEntities("a &lt;b&gt; &amp; &#65;&#x42;")).toBe("a <b> & AB");
  });
});

describe("base64ToBytes", () => {
  it("round-trips ASCII bytes", () => {
    // "Man" → "TWFu"
    expect(Array.from(base64ToBytes("TWFu"))).toEqual([77, 97, 110]);
  });

  it("handles padding", () => {
    // "M" → "TQ==", "Ma" → "TWE="
    expect(Array.from(base64ToBytes("TQ=="))).toEqual([77]);
    expect(Array.from(base64ToBytes("TWE="))).toEqual([77, 97]);
  });
});
