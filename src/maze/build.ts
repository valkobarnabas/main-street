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
import { validateGraph } from "./validate";

export type BuildResult =
  | { ok: true; maze: MazeGraph; origin: LatLng; rect: Rect }
  | { ok: false; reason: string };

export async function buildMaze(bounds: ViewBounds): Promise<BuildResult> {
  const origin: LatLng = {
    lat: (bounds.north + bounds.south) / 2,
    lon: (bounds.east + bounds.west) / 2,
  };

  const corners = [
    project({ lat: bounds.south, lon: bounds.west }, origin),
    project({ lat: bounds.north, lon: bounds.east }, origin),
  ];
  const rect: Rect = {
    minX: Math.min(corners[0]!.x, corners[1]!.x),
    maxX: Math.max(corners[0]!.x, corners[1]!.x),
    minY: Math.min(corners[0]!.y, corners[1]!.y),
    maxY: Math.max(corners[0]!.y, corners[1]!.y),
  };

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
      reason: "No streets found here — zoom into a city neighborhood.",
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
