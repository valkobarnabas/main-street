import type { RawGraph } from "./graph";
import type { Rect } from "./clip";
import type { ViewBounds } from "../types";

/** Longest view side allowed for a playable round (meters). */
export const MAX_VIEW_SIDE_METERS = 3000;

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateViewSize(bounds: ViewBounds): ValidationResult {
  const longest = Math.max(bounds.widthMeters, bounds.heightMeters);
  if (longest > MAX_VIEW_SIDE_METERS) {
    return {
      ok: false,
      reason: "Area too large — zoom in to a few blocks (not the whole city).",
    };
  }
  return { ok: true };
}

export function validateGraph(g: RawGraph, _rect: Rect): ValidationResult {
  const edgeCount = g.edges.size;

  if (edgeCount < 1) {
    return {
      ok: false,
      reason: "No streets in view — pan to cover at least one road.",
    };
  }
  return { ok: true };
}
