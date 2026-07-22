import type { LatLng, MazeGraph, ViewBounds } from "../types";
import { fetchStreets } from "../osm/overpass";
import { clipPolyline, type Rect } from "./clip";
import { project } from "./geo";
import {
  buildGraph,
  connectNearMisses,
  largestComponent,
  pruneStubs,
  simplifyGraph,
} from "./graph";
import { placePellets, pickHomeNode } from "./pellets";
import { buildPortals } from "./portals";
import { validateGraph, validateViewSize } from "./validate";

export type BuildResult =
  | { ok: true; maze: MazeGraph; origin: LatLng; rect: Rect }
  | { ok: false; reason: string };

/** Inset playable rect slightly so road strokes stay on-screen. */
const EDGE_PAD_METERS = 2;

export async function buildMaze(bounds: ViewBounds): Promise<BuildResult> {
  const sizeCheck = validateViewSize(bounds);
  if (!sizeCheck.ok) return sizeCheck;

  const origin: LatLng = {
    lat: (bounds.north + bounds.south) / 2,
    lon: (bounds.east + bounds.west) / 2,
  };

  const corners = [
    project({ lat: bounds.south, lon: bounds.west }, origin),
    project({ lat: bounds.north, lon: bounds.east }, origin),
  ];
  const raw: Rect = {
    minX: Math.min(corners[0]!.x, corners[1]!.x),
    maxX: Math.max(corners[0]!.x, corners[1]!.x),
    minY: Math.min(corners[0]!.y, corners[1]!.y),
    maxY: Math.max(corners[0]!.y, corners[1]!.y),
  };

  // Shrink so corridors don't stick past the screen edge
  const pad = Math.min(
    EDGE_PAD_METERS,
    (raw.maxX - raw.minX) * 0.04,
    (raw.maxY - raw.minY) * 0.04,
  );
  const rect: Rect = {
    minX: raw.minX + pad,
    maxX: raw.maxX - pad,
    minY: raw.minY + pad,
    maxY: raw.maxY - pad,
  };

  if (rect.maxX - rect.minX < 40 || rect.maxY - rect.minY < 40) {
    return {
      ok: false,
      reason: "View is too small after padding — zoom out a little.",
    };
  }

  let ways;
  try {
    ways = await fetchStreets(bounds);
  } catch (err) {
    console.error(err);
    return {
      ok: false,
      reason: "Could not load streets from OpenStreetMap. Try again in a moment.",
    };
  }

  if (ways.length === 0) {
    return {
      ok: false,
      reason: "No streets found here — pan to cover at least one road.",
    };
  }

  const projected = ways.map((w) => w.map((ll) => project(ll, origin)));
  const clipped: typeof projected = [];
  for (const line of projected) {
    clipped.push(...clipPolyline(line, rect));
  }

  if (clipped.length === 0) {
    return {
      ok: false,
      reason: "Streets do not cross the view — pan to cover more roads.",
    };
  }

  let g = buildGraph(clipped, rect);
  g = simplifyGraph(g);
  g = connectNearMisses(g, rect);
  g = pruneStubs(g);
  // Re-link after stub pruning; promote rim leaves onto the visible edge.
  g = connectNearMisses(g, rect);
  g = largestComponent(g);

  const validation = validateGraph(g, rect);
  if (!validation.ok) return validation;

  const portals = buildPortals(g);
  const pellets = placePellets(g);
  const homeNodeId = pickHomeNode(g);

  const maze: MazeGraph = {
    nodes: g.nodes,
    edges: g.edges,
    adj: g.adj,
    portals,
    pellets,
    homeNodeId,
    bounds: {
      minX: rect.minX,
      minY: rect.minY,
      maxX: rect.maxX,
      maxY: rect.maxY,
    },
  };

  return { ok: true, maze, origin, rect };
}
