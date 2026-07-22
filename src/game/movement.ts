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

/**
 * Local bearing when traveling along an edge (first segment in that direction).
 * Using the full chord made diagonal X-junctions unturnable.
 */
export function edgeBearing(maze: MazeGraph, edgeId: number, forward: boolean): number {
  const e = maze.edges.get(edgeId)!;
  const pts = e.points;
  if (pts.length < 2) return 0;
  const from = forward ? pts[0]! : pts[pts.length - 1]!;
  const to = forward ? pts[1]! : pts[pts.length - 2]!;
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/** Face along the current edge in the direction that best matches `desired`. */
export function orientPoseToDesired(
  maze: MazeGraph,
  pose: EdgePose,
  desired: DesiredDir,
): EdgePose {
  if (!desired) return pose;
  if (!maze.edges.has(pose.edgeId)) return pose;
  const want = desiredDirToBearing(desired);
  const forwardDiff = angleDiff(edgeBearing(maze, pose.edgeId, true), want);
  const backDiff = angleDiff(edgeBearing(maze, pose.edgeId, false), want);
  return { ...pose, forward: forwardDiff <= backDiff };
}

/** Bearing leaving `nodeId` along `edgeId`. */
function exitBearing(maze: MazeGraph, edgeId: number, nodeId: number): number {
  return edgeBearing(maze, edgeId, facingToward(maze, edgeId, nodeId));
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
 * No U-turns mid-road or at junctions — reverse only at interior dead-ends.
 * Boundary dead-ends may wrap via portals.
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
    const degree = (maze.adj.get(hitNode) ?? []).length;

    // Map-edge dead-end: wrap to the far side when a portal exists.
    if (degree <= 1) {
      const portal = portalPartner(maze.portals, hitNode);
      if (portal) {
        const nextPose = enterFromPortal(maze, portal.partnerId, desired);
        if (nextPose) {
          cur = nextPose;
          portalUsed = true;
          continue;
        }
      }
      // Interior stub (or failed wrap) — turn around on the same road.
      cur = {
        edgeId: cur.edgeId,
        t: hitNode === e.a ? 0 : 1,
        forward: hitNode === e.a,
      };
      remaining = 0;
      break;
    }

    const next = chooseOutgoing(maze, hitNode, cur.edgeId, desired, turnThreshold);
    if (!next) {
      // No legal exit — reverse (shouldn't happen when degree > 1).
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
  _turnThreshold: number,
): EdgePose | null {
  const eids = (maze.adj.get(nodeId) ?? []).filter((id) => id !== fromEdgeId);
  if (eids.length === 0) return null;

  // Arrival bearing (direction we were traveling into the junction).
  const arrivalBrg = edgeBearing(
    maze,
    fromEdgeId,
    !facingToward(maze, fromEdgeId, nodeId),
  );

  const poseOn = (eid: number): EdgePose => {
    const e = maze.edges.get(eid)!;
    return { edgeId: eid, t: e.a === nodeId ? 0 : 1, forward: e.a === nodeId };
  };

  // Prefer the most straightforward continuation whenever possible.
  let straightEid = eids[0]!;
  let straightDiff = Infinity;
  for (const eid of eids) {
    const d = angleDiff(exitBearing(maze, eid, nodeId), arrivalBrg);
    if (d < straightDiff) {
      straightDiff = d;
      straightEid = eid;
    }
  }

  if (!desired) return poseOn(straightEid);

  const want = desiredDirToBearing(desired);
  const straightBrg = exitBearing(maze, straightEid, nodeId);
  const straightToWant = angleDiff(straightBrg, want);

  // Never U-turn back onto the arrival road at a junction — only side exits
  // or continue straight. (Dead-ends reverse in advancePose.)
  const STRAIGHT_BIAS = 18;
  let bestTurn: number | null = null;
  let bestTurnToWant = Infinity;
  for (const eid of eids) {
    if (eid === straightEid) continue;
    const d = angleDiff(exitBearing(maze, eid, nodeId), want);
    if (d < bestTurnToWant) {
      bestTurnToWant = d;
      bestTurn = eid;
    }
  }

  if (
    bestTurn != null &&
    bestTurnToWant + STRAIGHT_BIAS < straightToWant
  ) {
    return poseOn(bestTurn);
  }

  return poseOn(straightEid);
}

export function actorsTouching(
  maze: MazeGraph,
  a: EdgePose,
  b: EdgePose,
  radius: number,
): boolean {
  return dist(poseWorld(maze, a), poseWorld(maze, b)) <= radius;
}
