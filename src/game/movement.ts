import type { DesiredDir, EdgePose, MazeGraph, Vec2 } from "../types";
import {
  angleDiff,
  desiredDirToBearing,
  dist,
  pointOnPolyline,
} from "../maze/geo";
import { portalPartner } from "../maze/portals";

export function poseWorld(maze: MazeGraph, pose: EdgePose): Vec2 {
  const e = maze.edges.get(pose.edgeId)!;
  return pointOnPolyline(e.points, pose.t);
}

export function edgeBearing(maze: MazeGraph, edgeId: number, forward: boolean): number {
  const e = maze.edges.get(edgeId)!;
  const pts = e.points;
  if (pts.length < 2) return 0;
  const a = forward ? pts[0]! : pts[pts.length - 1]!;
  const b = forward ? pts[Math.min(1, pts.length - 1)]! : pts[Math.max(0, pts.length - 2)]!;
  // Use endpoints for more stable bearing
  const from = forward ? pts[0]! : pts[pts.length - 1]!;
  const to = forward ? pts[pts.length - 1]! : pts[0]!;
  void a;
  void b;
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function facingToward(
  maze: MazeGraph,
  edgeId: number,
  fromNode: number,
): boolean {
  const e = maze.edges.get(edgeId)!;
  return e.a === fromNode; // forward means a->b
}

export function pickSpawnPose(maze: MazeGraph): EdgePose {
  // Prefer a medium-length edge near the center
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (const node of maze.nodes.values()) {
    cx += node.x;
    cy += node.y;
    n++;
  }
  cx /= Math.max(1, n);
  cy /= Math.max(1, n);

  let best: EdgePose = { edgeId: [...maze.edges.keys()][0]!, t: 0.5, forward: true };
  let bestScore = Infinity;
  for (const e of maze.edges.values()) {
    const mid = pointOnPolyline(e.points, 0.5);
    const score = Math.hypot(mid.x - cx, mid.y - cy) - e.length * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = { edgeId: e.id, t: 0.5, forward: true };
    }
  }
  return best;
}

export function poseAtNode(
  maze: MazeGraph,
  nodeId: number,
  preferredDir: DesiredDir,
): EdgePose | null {
  const eids = maze.adj.get(nodeId) ?? [];
  if (eids.length === 0) return null;

  let chosen = eids[0]!;
  if (preferredDir) {
    const want = desiredDirToBearing(preferredDir);
    let best = Infinity;
    for (const eid of eids) {
      const forward = facingToward(maze, eid, nodeId);
      const brg = edgeBearing(maze, eid, forward);
      const d = angleDiff(brg, want);
      if (d < best) {
        best = d;
        chosen = eid;
      }
    }
  }

  const e = maze.edges.get(chosen)!;
  const forward = e.a === nodeId;
  return { edgeId: chosen, t: forward ? 0 : 1, forward };
}

/**
 * Advance along the graph. Returns updated pose and whether a portal was used.
 */
export function advancePose(
  maze: MazeGraph,
  pose: EdgePose,
  distance: number,
  desired: DesiredDir,
  turnThreshold = 75,
): { pose: EdgePose; portalUsed: boolean } {
  let remaining = distance;
  let cur = { ...pose };
  let portalUsed = false;
  let guard = 0;

  while (remaining > 0 && guard++ < 20) {
    const e = maze.edges.get(cur.edgeId)!;

    // Can reverse immediately if desired opposes current travel
    if (desired) {
      const travelBrg = edgeBearing(maze, cur.edgeId, cur.forward);
      const want = desiredDirToBearing(desired);
      if (angleDiff(travelBrg, want) > 180 - 25) {
        cur.forward = !cur.forward;
      }
    }

    const nextT = cur.t + (cur.forward ? remaining / e.length : -remaining / e.length);

    if (nextT > 0 && nextT < 1) {
      cur.t = nextT;
      remaining = 0;
      break;
    }

    // Hit a node
    const hitNode = nextT >= 1 ? e.b : e.a;
    const used = Math.abs((nextT >= 1 ? 1 - cur.t : cur.t) * e.length);
    remaining = Math.max(0, remaining - used);

    // Portal wrap: leaving a paired boundary exit re-enters at its match
    const portal = portalPartner(maze.portals, hitNode);
    if (portal) {
      const degree = (maze.adj.get(hitNode) ?? []).length;
      const onlyWayBack = degree <= 1;
      const outward = isOutwardExit(maze, hitNode, cur.edgeId, desired);
      if (onlyWayBack || outward) {
        const nextPose = enterFromPortal(maze, portal.partnerId, desired);
        if (nextPose) {
          cur = nextPose;
          portalUsed = true;
          continue;
        }
      }
    }

    const next = chooseOutgoing(maze, hitNode, cur.edgeId, desired, turnThreshold);
    if (!next) {
      // Dead end — reverse
      cur = {
        edgeId: cur.edgeId,
        t: hitNode === e.a ? 0 : 1,
        forward: hitNode === e.a,
      };
      remaining = 0;
      break;
    }
    cur = next;
  }

  return { pose: cur, portalUsed };
}

/** True when the player is leaving the maze through a boundary portal. */
function isOutwardExit(
  maze: MazeGraph,
  nodeId: number,
  fromEdgeId: number,
  desired: DesiredDir,
): boolean {
  const node = maze.nodes.get(nodeId);
  if (!node?.onBoundary || !node.boundarySide) return false;
  const others = (maze.adj.get(nodeId) ?? []).filter((id) => id !== fromEdgeId);
  if (others.length === 0) return true;
  if (!desired) return false;
  const want = desiredDirToBearing(desired);
  // Outward bearings by side
  const outwardBrg =
    node.boundarySide === "left"
      ? 180
      : node.boundarySide === "right"
        ? 0
        : node.boundarySide === "top"
          ? 90
          : -90;
  return angleDiff(want, outwardBrg) <= 50;
}

function enterFromPortal(
  maze: MazeGraph,
  partnerId: number,
  desired: DesiredDir,
): EdgePose | null {
  const eids = maze.adj.get(partnerId) ?? [];
  if (eids.length === 0) return null;

  let chosen = eids[0]!;
  if (desired) {
    const want = desiredDirToBearing(desired);
    let best = Infinity;
    for (const eid of eids) {
      const forward = facingToward(maze, eid, partnerId);
      const d = angleDiff(edgeBearing(maze, eid, forward), want);
      if (d < best) {
        best = d;
        chosen = eid;
      }
    }
  } else {
    // Prefer heading into the maze (away from boundary)
    const node = maze.nodes.get(partnerId)!;
    let best = -Infinity;
    for (const eid of eids) {
      const forward = facingToward(maze, eid, partnerId);
      const brg = edgeBearing(maze, eid, forward);
      // Score how inward the bearing is
      let inward = 0;
      if (node.boundarySide === "left") inward = Math.cos((brg * Math.PI) / 180);
      if (node.boundarySide === "right") inward = -Math.cos((brg * Math.PI) / 180);
      if (node.boundarySide === "bottom") inward = Math.sin((brg * Math.PI) / 180);
      if (node.boundarySide === "top") inward = -Math.sin((brg * Math.PI) / 180);
      if (inward > best) {
        best = inward;
        chosen = eid;
      }
    }
  }

  const e = maze.edges.get(chosen)!;
  const forward = e.a === partnerId;
  return { edgeId: chosen, t: forward ? 0 : 1, forward };
}

function chooseOutgoing(
  maze: MazeGraph,
  nodeId: number,
  fromEdgeId: number,
  desired: DesiredDir,
  turnThreshold: number,
): EdgePose | null {
  const eids = (maze.adj.get(nodeId) ?? []).filter((id) => id !== fromEdgeId);
  if (eids.length === 0) return null;

  if (!desired) {
    // Continue straight-ish
    const fromBrg = edgeBearing(
      maze,
      fromEdgeId,
      !facingToward(maze, fromEdgeId, nodeId),
    );
    let best = eids[0]!;
    let bestDiff = Infinity;
    for (const eid of eids) {
      const forward = facingToward(maze, eid, nodeId);
      const d = angleDiff(edgeBearing(maze, eid, forward), fromBrg);
      if (d < bestDiff) {
        bestDiff = d;
        best = eid;
      }
    }
    const e = maze.edges.get(best)!;
    return { edgeId: best, t: e.a === nodeId ? 0 : 1, forward: e.a === nodeId };
  }

  const want = desiredDirToBearing(desired);
  let best: number | null = null;
  let bestDiff = Infinity;
  for (const eid of eids) {
    const forward = facingToward(maze, eid, nodeId);
    const d = angleDiff(edgeBearing(maze, eid, forward), want);
    if (d < bestDiff) {
      bestDiff = d;
      best = eid;
    }
  }

  // Also consider reversing back if that's the best match to desired
  const reverseDiff = angleDiff(
    edgeBearing(maze, fromEdgeId, facingToward(maze, fromEdgeId, nodeId)),
    want,
  );
  if (reverseDiff + 5 < bestDiff && reverseDiff <= turnThreshold) {
    const e = maze.edges.get(fromEdgeId)!;
    return {
      edgeId: fromEdgeId,
      t: e.a === nodeId ? 0 : 1,
      forward: e.a === nodeId,
    };
  }

  if (best == null || bestDiff > turnThreshold) {
    // No good turn — try to continue straight
    const fromBrg = edgeBearing(
      maze,
      fromEdgeId,
      !facingToward(maze, fromEdgeId, nodeId),
    );
    let straight: number | null = null;
    let sd = Infinity;
    for (const eid of eids) {
      const forward = facingToward(maze, eid, nodeId);
      const d = angleDiff(edgeBearing(maze, eid, forward), fromBrg);
      if (d < sd) {
        sd = d;
        straight = eid;
      }
    }
    if (straight == null) return null;
    const e = maze.edges.get(straight)!;
    return {
      edgeId: straight,
      t: e.a === nodeId ? 0 : 1,
      forward: e.a === nodeId,
    };
  }

  const e = maze.edges.get(best)!;
  return { edgeId: best, t: e.a === nodeId ? 0 : 1, forward: e.a === nodeId };
}

export function actorsTouching(
  maze: MazeGraph,
  a: EdgePose,
  b: EdgePose,
  radius: number,
): boolean {
  return dist(poseWorld(maze, a), poseWorld(maze, b)) <= radius;
}
