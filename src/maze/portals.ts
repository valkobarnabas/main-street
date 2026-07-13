import type { GraphNode, PortalPair } from "../types";
import type { RawGraph } from "./graph";

type Cand = { id: number; node: GraphNode; along: number };

function sideCandidates(
  g: RawGraph,
  side: "left" | "right" | "top" | "bottom",
): Cand[] {
  const out: Cand[] = [];
  for (const node of g.nodes.values()) {
    if (!node.onBoundary || node.boundarySide !== side) continue;
    if ((g.adj.get(node.id) ?? []).length === 0) continue;
    const along = side === "left" || side === "right" ? node.y : node.x;
    out.push({ id: node.id, node, along });
  }
  out.sort((a, b) => a.along - b.along);
  return out;
}

function pairSides(a: Cand[], b: Cand[], pairs: PortalPair[]): void {
  const usedB = new Set<number>();
  for (const ca of a) {
    let best: Cand | null = null;
    let bestDist = Infinity;
    for (const cb of b) {
      if (usedB.has(cb.id)) continue;
      const d = Math.abs(ca.along - cb.along);
      if (d < bestDist) {
        bestDist = d;
        best = cb;
      }
    }
    if (!best) continue;
    if (bestDist > 120) continue;
    usedB.add(best.id);
    pairs.push({
      id: `p-${ca.id}-${best.id}`,
      nodeA: ca.id,
      nodeB: best.id,
    });
  }
}

/** Pair opposite-edge exits for silent wrap (no on-screen labels). */
export function buildPortals(g: RawGraph): PortalPair[] {
  const pairs: PortalPair[] = [];
  pairSides(sideCandidates(g, "left"), sideCandidates(g, "right"), pairs);
  pairSides(sideCandidates(g, "top"), sideCandidates(g, "bottom"), pairs);
  return pairs;
}

export function portalPartner(
  portals: PortalPair[],
  nodeId: number,
): { partnerId: number; pair: PortalPair } | null {
  for (const p of portals) {
    if (p.nodeA === nodeId) return { partnerId: p.nodeB, pair: p };
    if (p.nodeB === nodeId) return { partnerId: p.nodeA, pair: p };
  }
  return null;
}
