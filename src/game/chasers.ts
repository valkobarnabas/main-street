import type {
  DesiredDir,
  EdgePose,
  Chaser,
  ChaserRole,
  MazeGraph,
  Vec2,
} from "../types";
import { dist } from "../maze/geo";
import { advancePose, pickSpawnPose, poseAtNode, poseWorld } from "./movement";

const CHASER_META: Record<
  ChaserRole,
  { color: string; scatterCorner: "ne" | "nw" | "se" | "sw" }
> = {
  rusher: { color: "#f06020", scatterCorner: "ne" },
  sneaker: { color: "#e85818", scatterCorner: "nw" },
  trickster: { color: "#ff7a3d", scatterCorner: "se" },
  loafer: { color: "#d45010", scatterCorner: "sw" },
};

function cornerNode(
  maze: MazeGraph,
  corner: "ne" | "nw" | "se" | "sw",
): number {
  let best = [...maze.nodes.keys()][0]!;
  let bestScore = -Infinity;
  for (const n of maze.nodes.values()) {
    let score = 0;
    if (corner.includes("e")) score += n.x;
    else score -= n.x;
    if (corner.includes("n")) score += n.y;
    else score -= n.y;
    if (score > bestScore) {
      bestScore = score;
      best = n.id;
    }
  }
  return best;
}

export function createChasers(maze: MazeGraph): Chaser[] {
  const roles: ChaserRole[] = ["rusher", "sneaker", "trickster", "loafer"];
  const edges = [...maze.edges.values()];
  const poses = pickSpreadPoses(maze, edges, roles.length, 45);

  return roles.map((role, i) => {
    const meta = CHASER_META[role];
    return {
      role,
      color: meta.color,
      pose: poses[i]!,
      state: "scatter" as const,
      scatterNodeId: cornerNode(maze, meta.scatterCorner),
    };
  });
}

/** Random edge poses, preferring spots that aren't stacked on each other. */
function pickSpreadPoses(
  maze: MazeGraph,
  edges: GraphEdgeLike[],
  count: number,
  minSep: number,
): EdgePose[] {
  const poses: EdgePose[] = [];
  const maxAttempts = Math.max(40, count * 25);

  for (let attempt = 0; attempt < maxAttempts && poses.length < count; attempt++) {
    const e = edges[Math.floor(Math.random() * edges.length)]!;
    const pose: EdgePose = {
      edgeId: e.id,
      t: 0.15 + Math.random() * 0.7,
      forward: Math.random() < 0.5,
    };
    const p = poseWorld(maze, pose);
    if (poses.every((other) => dist(p, poseWorld(maze, other)) >= minSep)) {
      poses.push(pose);
    }
  }

  // Fallback if the maze is too small to spread out.
  while (poses.length < count) {
    const e = edges[Math.floor(Math.random() * edges.length)]!;
    poses.push({
      edgeId: e.id,
      t: 0.15 + Math.random() * 0.7,
      forward: Math.random() < 0.5,
    });
  }

  return poses;
}

type GraphEdgeLike = { id: number };

function nearestNode(maze: MazeGraph, p: Vec2): number {
  let best = [...maze.nodes.keys()][0]!;
  let bestD = Infinity;
  for (const n of maze.nodes.values()) {
    const d = dist(p, n);
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

function nextHop(
  maze: MazeGraph,
  fromNode: number,
  toNode: number,
): number | null {
  if (fromNode === toNode) return null;
  const prev = new Map<number, number | null>();
  const q: number[] = [fromNode];
  prev.set(fromNode, null);
  while (q.length) {
    const n = q.shift()!;
    if (n === toNode) break;
    for (const eid of maze.adj.get(n) ?? []) {
      const e = maze.edges.get(eid)!;
      const o = e.a === n ? e.b : e.a;
      if (prev.has(o)) continue;
      prev.set(o, n);
      q.push(o);
    }
  }
  if (!prev.has(toNode)) return null;
  let cur = toNode;
  while (prev.get(cur) != null && prev.get(cur) !== fromNode) {
    cur = prev.get(cur)!;
  }
  return cur;
}

function dirTowardNode(
  maze: MazeGraph,
  from: Vec2,
  nodeId: number,
): DesiredDir {
  const n = maze.nodes.get(nodeId)!;
  const dx = n.x - from.x;
  const dy = n.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "up" : "down";
}

function targetForChaser(
  maze: MazeGraph,
  chaser: Chaser,
  playerPose: EdgePose,
  mode: "scatter" | "chase",
  rusherPose: EdgePose,
): number {
  const playerPos = poseWorld(maze, playerPose);
  const playerNode = nearestNode(maze, playerPos);

  if (chaser.state === "eaten") return maze.homeNodeId;
  if (chaser.state === "frightened") return chaser.scatterNodeId;
  if (mode === "scatter") return chaser.scatterNodeId;

  switch (chaser.role) {
    case "rusher":
      return playerNode;
    case "sneaker": {
      const e = maze.edges.get(playerPose.edgeId)!;
      return playerPose.forward ? e.b : e.a;
    }
    case "trickster": {
      const rusherPos = poseWorld(maze, rusherPose);
      const px = playerPos.x + (playerPos.x - rusherPos.x);
      const py = playerPos.y + (playerPos.y - rusherPos.y);
      return nearestNode(maze, { x: px, y: py });
    }
    case "loafer": {
      if (dist(poseWorld(maze, chaser.pose), playerPos) < 60) {
        return chaser.scatterNodeId;
      }
      return playerNode;
    }
  }
}

function nodeAhead(maze: MazeGraph, pose: EdgePose): number {
  const e = maze.edges.get(pose.edgeId)!;
  return pose.forward ? e.b : e.a;
}

function nodeBehind(maze: MazeGraph, pose: EdgePose): number {
  const e = maze.edges.get(pose.edgeId)!;
  return pose.forward ? e.a : e.b;
}

/** Random reachable node — used while frightened so AI stays on the graph. */
function randomNodeId(maze: MazeGraph): number {
  const ids = [...maze.nodes.keys()];
  return ids[Math.floor(Math.random() * ids.length)]!;
}

export function updateChaser(
  maze: MazeGraph,
  chaser: Chaser,
  playerPose: EdgePose,
  rusherPose: EdgePose,
  mode: "scatter" | "chase",
  dt: number,
  speed: number,
): void {
  const ahead = nodeAhead(maze, chaser.pose);
  const behind = nodeBehind(maze, chaser.pose);
  let target = targetForChaser(maze, chaser, playerPose, mode, rusherPose);

  // Frightened: occasionally pick a new wander target instead of a random
  // screen direction (which caused mid-road oscillation / stuck cones).
  if (chaser.state === "frightened" && Math.random() < 0.04) {
    target = randomNodeId(maze);
  }

  // Pathfind from the node we're already committed to — not nearestNode mid-edge,
  // which often points behind the chaser and makes them jitter in place.
  const hop = nextHop(maze, ahead, target);
  let desired: DesiredDir;
  if (hop == null) {
    desired = dirTowardNode(maze, maze.nodes.get(ahead)!, target);
  } else if (hop === behind) {
    desired = dirTowardNode(maze, maze.nodes.get(ahead)!, behind);
  } else {
    // Keep traveling to `ahead`; desired encodes the turn to take on arrival.
    desired = dirTowardNode(maze, maze.nodes.get(ahead)!, hop);
  }

  // Allow any turn at junctions so pathfinding isn't ignored on sharp corners.
  const { pose } = advancePose(maze, chaser.pose, speed * dt, desired, 180);
  chaser.pose = pose;

  if (chaser.state === "eaten") {
    if (nodeAhead(maze, chaser.pose) === maze.homeNodeId || nodeBehind(maze, chaser.pose) === maze.homeNodeId) {
      const atHome =
        nearestNode(maze, poseWorld(maze, chaser.pose)) === maze.homeNodeId;
      if (atHome) {
        chaser.state = mode;
        const homePose = poseAtNode(maze, maze.homeNodeId, null);
        if (homePose) chaser.pose = homePose;
      }
    }
  }
}

export function resetChasers(maze: MazeGraph, chasers: Chaser[]): void {
  const fresh = createChasers(maze);
  for (let i = 0; i < chasers.length; i++) {
    // Eaten-for-good chasers stay gone
    if (chasers[i]!.state === "gone") continue;
    chasers[i]!.pose = fresh[i]!.pose;
    chasers[i]!.state = "scatter";
  }
}

export function frightenChasers(chasers: Chaser[]): void {
  for (const g of chasers) {
    if (g.state === "gone" || g.state === "eaten") continue;
    g.state = "frightened";
  }
}

export function endFrighten(chasers: Chaser[], mode: "scatter" | "chase"): void {
  for (const g of chasers) {
    if (g.state === "frightened") g.state = mode;
  }
}

export { pickSpawnPose, nearestNode };
