import type { DesiredDir, EdgePose, MazeGraph, Vec2 } from "../types";
import {
  angleDiff,
  desiredDirToBearing,
  dist,
  pointOnPolyline,
  signedAngleDiff,
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
 * Advance along the graph.
 * No U-turns mid-road or at junctions — reverse only at interior dead-ends.
 * Boundary dead-ends may wrap via portals.
 * `consumedTurn` is true when a buffered arrow caused a real side turn.
 */
export function advancePose(
  maze: MazeGraph,
  pose: EdgePose,
  distance: number,
  desired: DesiredDir,
  turnThreshold = 75,
): { pose: EdgePose; portalUsed: boolean; consumedTurn: boolean } {
  let remaining = distance;
  let cur = { ...pose };
  let portalUsed = false;
  let consumedTurn = false;
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

    const picked = chooseOutgoing(maze, hitNode, cur.edgeId, desired, turnThreshold);
    if (!picked) {
      cur = {
        edgeId: cur.edgeId,
        t: hitNode === e.a ? 0 : 1,
        forward: hitNode === e.a,
      };
      remaining = 0;
      break;
    }
    if (picked.consumedTurn) consumedTurn = true;
    cur = picked.pose;
  }

  return { pose: cur, portalUsed, consumedTurn };
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

/**
 * Pick the next edge at a junction.
 * - No input: stay on the exit closest to current heading (never U-turn).
 * - Arrow held/buffered: if any exit lies on that side of the car, take it
 *   (`consumedTurn`); otherwise keep going straightest-forward.
 */
function chooseOutgoing(
  maze: MazeGraph,
  nodeId: number,
  fromEdgeId: number,
  desired: DesiredDir,
  _turnThreshold: number,
): { pose: EdgePose; consumedTurn: boolean } | null {
  const eids = (maze.adj.get(nodeId) ?? []).filter((id) => id !== fromEdgeId);
  if (eids.length === 0) return null;

  const facing = edgeBearing(
    maze,
    fromEdgeId,
    !facingToward(maze, fromEdgeId, nodeId),
  );

  const poseOn = (eid: number): EdgePose => {
    const e = maze.edges.get(eid)!;
    return { edgeId: eid, t: e.a === nodeId ? 0 : 1, forward: e.a === nodeId };
  };

  const exitMeta = eids.map((eid) => {
    const brg = exitBearing(maze, eid, nodeId);
    return {
      eid,
      brg,
      turn: signedAngleDiff(facing, brg),
      forwardErr: angleDiff(brg, facing),
    };
  });

  const pickStraightest = () => {
    let best = exitMeta[0]!;
    for (const m of exitMeta) {
      if (m.forwardErr < best.forwardErr) best = m;
    }
    return { pose: poseOn(best.eid), consumedTurn: false };
  };

  if (!desired) return pickStraightest();

  const want = desiredDirToBearing(desired);
  const keySide = signedAngleDiff(facing, want);

  if (Math.abs(keySide) >= 150) return pickStraightest();
  if (Math.abs(keySide) <= 25) return pickStraightest();

  const wantRight = keySide < 0;
  const sideExits = exitMeta.filter((m) =>
    wantRight ? m.turn < -1 : m.turn > 1,
  );

  if (sideExits.length === 0) return pickStraightest();

  let best = sideExits[0]!;
  let bestToKey = angleDiff(best.brg, want);
  for (const m of sideExits) {
    const d = angleDiff(m.brg, want);
    if (d < bestToKey || (d === bestToKey && m.forwardErr < best.forwardErr)) {
      best = m;
      bestToKey = d;
    }
  }
  return { pose: poseOn(best.eid), consumedTurn: true };
}

export function actorsTouching(
  maze: MazeGraph,
  a: EdgePose,
  b: EdgePose,
  radius: number,
): boolean {
  return dist(poseWorld(maze, a), poseWorld(maze, b)) <= radius;
}
