import type { Pellet, Vec2 } from "../types";
import type { RawGraph } from "./graph";
import { pointOnPolyline } from "./geo";

const PELLET_SPACING = 12; // meters
const POWER_MIN_SEP = 55; // meters between power dots

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

export function placePellets(g: RawGraph): Pellet[] {
  const pellets: Pellet[] = [];
  let id = 1;

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

  // Scatter power dots randomly across the maze (with minimum spacing).
  const powerCount = Math.min(4, Math.max(2, Math.floor(pellets.length / 40)));
  const order = pellets.map((_, i) => i);
  shuffleInPlace(order);

  const chosen: Pellet[] = [];
  for (const idx of order) {
    if (chosen.length >= powerCount) break;
    const candidate = pellets[idx]!;
    const farEnough = chosen.every(
      (o) => Math.hypot(candidate.x - o.x, candidate.y - o.y) >= POWER_MIN_SEP,
    );
    if (farEnough) {
      candidate.power = true;
      chosen.push(candidate);
    }
  }

  // If the map is tiny and spacing blocked us, fill remaining at random.
  if (chosen.length < powerCount) {
    for (const idx of order) {
      if (chosen.length >= powerCount) break;
      const candidate = pellets[idx]!;
      if (candidate.power) continue;
      candidate.power = true;
      chosen.push(candidate);
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
