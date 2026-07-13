import type { RawGraph } from "./graph";
import type { Rect } from "./clip";

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateGraph(g: RawGraph, rect: Rect): ValidationResult {
  const nodeCount = g.nodes.size;
  const edgeCount = g.edges.size;
  let totalLen = 0;
  for (const e of g.edges.values()) totalLen += e.length;

  const span = Math.max(rect.maxX - rect.minX, rect.maxY - rect.minY);

  if (edgeCount < 4) {
    return {
      ok: false,
      reason: "Not enough streets in view — zoom into a denser neighborhood.",
    };
  }
  if (nodeCount < 4) {
    return {
      ok: false,
      reason: "Too few intersections — try a grid of city blocks.",
    };
  }
  if (totalLen < span * 0.8) {
    return {
      ok: false,
      reason: "Streets are too sparse here — zoom in or pick a busier area.",
    };
  }
  return { ok: true };
}
