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
  rusher: { color: "#e74c3c", scatterCorner: "ne" },
  sneaker: { color: "#e91e8c", scatterCorner: "nw" },
  trickster: { color: "#1abc9c", scatterCorner: "se" },
  loafer: { color: "#e67e22", scatterCorner: "sw" },
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
  return roles.map((role, i) => {
    const meta = CHASER_META[role];
    const e = edges[(i * 3 + 1) % edges.length]!;
    const pose: EdgePose = {
      edgeId: e.id,
      t: 0.3 + i * 0.1,
      forward: i % 2 === 0,
    };
    return {
      role,
      color: meta.color,
      pose,
      state: "scatter" as const,
      scatterNodeId: cornerNode(maze, meta.scatterCorner),
    };
  });
}

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

export function updateChaser(
  maze: MazeGraph,
  chaser: Chaser,
  playerPose: EdgePose,
  rusherPose: EdgePose,
  mode: "scatter" | "chase",
  dt: number,
  speed: number,
): void {
  const pos = poseWorld(maze, chaser.pose);
  const fromNode = nearestNode(maze, pos);
  const target = targetForChaser(maze, chaser, playerPose, mode, rusherPose);

  let desired: DesiredDir = null;
  const hop = nextHop(maze, fromNode, target);
  if (hop != null) desired = dirTowardNode(maze, pos, hop);
  else desired = dirTowardNode(maze, pos, target);

  if (chaser.state === "frightened" && Math.random() < 0.02) {
    const dirs: DesiredDir[] = ["up", "down", "left", "right"];
    desired = dirs[Math.floor(Math.random() * 4)]!;
  }

  const { pose } = advancePose(maze, chaser.pose, speed * dt, desired, 90);
  chaser.pose = pose;

  if (chaser.state === "eaten") {
    if (nearestNode(maze, poseWorld(maze, chaser.pose)) === maze.homeNodeId) {
      chaser.state = mode;
      const homePose = poseAtNode(maze, maze.homeNodeId, null);
      if (homePose) chaser.pose = homePose;
    }
  }
}

export function resetChasers(maze: MazeGraph, chasers: Chaser[]): void {
  const fresh = createChasers(maze);
  for (let i = 0; i < chasers.length; i++) {
    chasers[i]!.pose = fresh[i]!.pose;
    chasers[i]!.state = "scatter";
  }
}

export function frightenChasers(chasers: Chaser[]): void {
  for (const g of chasers) {
    if (g.state !== "eaten") g.state = "frightened";
  }
}

export function endFrighten(chasers: Chaser[], mode: "scatter" | "chase"): void {
  for (const g of chasers) {
    if (g.state === "frightened") g.state = mode;
  }
}

export { pickSpawnPose, nearestNode };
