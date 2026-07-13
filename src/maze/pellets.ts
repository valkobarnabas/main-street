import type { Pellet, Vec2 } from "../types";
import type { RawGraph } from "./graph";
import { pointOnPolyline } from "./geo";

const PELLET_SPACING = 12; // meters

export function placePellets(g: RawGraph): Pellet[] {
  const pellets: Pellet[] = [];
  let id = 1;

  // Prefer power pellets at degree-1 dead ends
  const deadEnds = new Set<number>();
  for (const [nid, edges] of g.adj) {
    if (edges.length === 1) deadEnds.add(nid);
  }

  for (const e of g.edges.values()) {
    const count = Math.max(1, Math.floor(e.length / PELLET_SPACING));
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const p = pointOnPolyline(e.points, t);
      pellets.push({
        id: id++,
        edgeId: e.id,
        t,
        x: p.x,
        y: p.y,
        power: false,
        eaten: false,
      });
    }
  }

  // Mark up to 4 power pellets near dead ends / far from center
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (const node of g.nodes.values()) {
    cx += node.x;
    cy += node.y;
    n++;
  }
  if (n > 0) {
    cx /= n;
    cy /= n;
  }

  const candidates = pellets
    .map((p) => ({
      p,
      score:
        (deadEnds.has(g.edges.get(p.edgeId)!.a) ||
        deadEnds.has(g.edges.get(p.edgeId)!.b)
          ? 40
          : 0) + Math.hypot(p.x - cx, p.y - cy),
    }))
    .sort((a, b) => b.score - a.score);

  const powerCount = Math.min(4, Math.max(2, Math.floor(pellets.length / 40)));
  const chosen = new Set<number>();
  for (const c of candidates) {
    if (chosen.size >= powerCount) break;
    // Keep power pellets spaced apart
    let ok = true;
    for (const oid of chosen) {
      const o = pellets.find((x) => x.id === oid)!;
      if (Math.hypot(c.p.x - o.x, c.p.y - o.y) < 40) {
        ok = false;
        break;
      }
    }
    if (ok) {
      c.p.power = true;
      chosen.add(c.p.id);
    }
  }

  return pellets;
}

export function pickHomeNode(g: RawGraph): number {
  let best = [...g.nodes.keys()][0] ?? 0;
  let bestDeg = -1;
  for (const [nid, eids] of g.adj) {
    if (eids.length > bestDeg) {
      bestDeg = eids.length;
      best = nid;
    }
  }
  return best;
}

export function nodePos(g: RawGraph, id: number): Vec2 {
  const n = g.nodes.get(id)!;
  return { x: n.x, y: n.y };
}
