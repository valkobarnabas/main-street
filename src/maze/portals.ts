import type { GraphNode, PortalPair } from "../types";
import type { RawGraph } from "./graph";

type Cand = { id: number; node: GraphNode; along: number; side: string };

function opposite(side: string): string {
  if (side === "left") return "right";
  if (side === "right") return "left";
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  return side;
}

/**
 * Only dead-ends on the play-area rim wrap. Interior stubs reverse in place.
 */
function boundaryLeafCandidates(g: RawGraph): Cand[] {
  const out: Cand[] = [];
  for (const node of g.nodes.values()) {
    if ((g.adj.get(node.id) ?? []).length !== 1) continue;
    if (!node.onBoundary || !node.boundarySide) continue;
    const side = node.boundarySide;
    const along = side === "left" || side === "right" ? node.y : node.x;
    out.push({ id: node.id, node, along, side });
  }
  return out;
}

/**
 * Boundary dead-ends wrap to a re-entry on the far side.
 * Interior dead-ends are not portaled (player/chasers reverse instead).
 */
export function buildPortals(g: RawGraph): PortalPair[] {
  const leaves = boundaryLeafCandidates(g);
  if (leaves.length === 0) return [];

  const bySide = new Map<string, Cand[]>();
  for (const c of leaves) {
    const list = bySide.get(c.side) ?? [];
    list.push(c);
    bySide.set(c.side, list);
  }
  for (const list of bySide.values()) {
    list.sort((a, b) => a.along - b.along);
  }

  const pairs: PortalPair[] = [];
  for (const exit of leaves) {
    const opp = opposite(exit.side);
    let targets = bySide.get(opp) ?? [];
    if (targets.length === 0 || (targets.length === 1 && targets[0]!.id === exit.id)) {
      targets = leaves.filter((t) => t.id !== exit.id);
    }
    if (targets.length === 0) continue;

    let best = targets[0]!;
    let bestDist = Infinity;
    for (const t of targets) {
      if (t.id === exit.id) continue;
      const d = Math.abs(t.along - exit.along);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (best.id === exit.id) continue;
    pairs.push({
      id: `wrap-${exit.id}-${best.id}`,
      nodeA: exit.id,
      nodeB: best.id,
    });
  }
  return pairs;
}

/** One-way wrap: leaving nodeA re-enters at nodeB. */
export function portalPartner(
  portals: PortalPair[],
  nodeId: number,
): { partnerId: number; pair: PortalPair } | null {
  for (const p of portals) {
    if (p.nodeA === nodeId) return { partnerId: p.nodeB, pair: p };
  }
  return null;
}
