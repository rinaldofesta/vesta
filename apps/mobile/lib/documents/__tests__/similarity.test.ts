import { dot, topKByCosine } from "../similarity";
import type { StoredChunk } from "../../storage/database";

function chunk(id: string, vec: number[]): StoredChunk {
  return {
    id,
    documentId: "d1",
    ordinal: 0,
    text: id,
    embedding: Float32Array.from(vec),
  };
}

describe("dot", () => {
  it("computes the dot product of two vectors", () => {
    expect(dot(Float32Array.from([1, 0, 0]), Float32Array.from([1, 0, 0]))).toBeCloseTo(1);
    expect(dot(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0);
    expect(dot(Float32Array.from([1, 2, 3]), Float32Array.from([4, 5, 6]))).toBeCloseTo(32);
  });
});

describe("topKByCosine", () => {
  it("ranks chunks by similarity and returns the top k", () => {
    const q = Float32Array.from([1, 0, 0]);
    const chunks = [
      chunk("far", [0, 1, 0]),
      chunk("near", [0.9, 0.1, 0]),
      chunk("exact", [1, 0, 0]),
    ];
    const top = topKByCosine(q, chunks, 2);
    expect(top.map((r) => r.chunk.id)).toEqual(["exact", "near"]);
  });

  it("returns all chunks when k exceeds the count", () => {
    const q = Float32Array.from([1, 0]);
    const chunks = [chunk("a", [1, 0]), chunk("b", [0, 1])];
    expect(topKByCosine(q, chunks, 10)).toHaveLength(2);
  });
});
