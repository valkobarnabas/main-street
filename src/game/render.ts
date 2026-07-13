import type { Chaser, LatLng, MazeGraph, EdgePose } from "../types";
import { unproject } from "../maze/geo";
import { poseWorld } from "./movement";
import type L from "leaflet";

export type RenderContext = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  map: L.Map;
  origin: LatLng;
};

export function resizeCanvas(canvas: HTMLCanvasElement): void {
  const stage = canvas.parentElement;
  const cssW = stage?.clientWidth || window.innerWidth;
  const cssH = stage?.clientHeight || window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function worldToScreen(
  map: L.Map,
  origin: LatLng,
  x: number,
  y: number,
): { sx: number; sy: number } {
  const ll = unproject({ x, y }, origin);
  const p = map.latLngToContainerPoint([ll.lat, ll.lon]);
  return { sx: p.x, sy: p.y };
}

function strokeAll(
  ctx: CanvasRenderingContext2D,
  paths: Array<Array<{ sx: number; sy: number }>>,
  color: string,
  width: number,
): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (const pts of paths) {
    if (pts.length < 2) continue;
    ctx.moveTo(pts[0]!.sx, pts[0]!.sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.sx, pts[i]!.sy);
  }
  ctx.stroke();
}

export function drawFrame(
  rc: RenderContext,
  maze: MazeGraph,
  player: EdgePose,
  chasers: Chaser[],
  pulse: number,
  frightenedFlash: boolean,
): void {
  const { canvas, ctx, map, origin } = rc;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(0, 0, 8, 0.55)";
  ctx.fillRect(0, 0, w, h);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const paths = [...maze.edges.values()].map((e) =>
    e.points.map((p) => worldToScreen(map, origin, p.x, p.y)),
  );

  // Two global passes so intersections merge into one corridor outline
  // (interleaved per-edge strokes cause blue cross-hatching).
  strokeAll(ctx, paths, "#2f6bff", 18);
  strokeAll(ctx, paths, "#000000", 12);

  for (const pellet of maze.pellets) {
    if (pellet.eaten) continue;
    const s = worldToScreen(map, origin, pellet.x, pellet.y);
    ctx.beginPath();
    ctx.fillStyle = pellet.power ? "#f5d0a9" : "#ffe566";
    ctx.arc(s.sx, s.sy, pellet.power ? 7 : 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player: directional chevron (not a wedge-mouth disc)
  const pp = poseWorld(maze, player);
  const ps = worldToScreen(map, origin, pp.x, pp.y);
  const e = maze.edges.get(player.edgeId)!;
  const from = player.forward ? e.points[0]! : e.points[e.points.length - 1]!;
  const to = player.forward ? e.points[e.points.length - 1]! : e.points[0]!;
  const screenFrom = worldToScreen(map, origin, from.x, from.y);
  const screenTo = worldToScreen(map, origin, to.x, to.y);
  const facing = Math.atan2(screenTo.sy - screenFrom.sy, screenTo.sx - screenFrom.sx);
  drawRunner(ctx, ps.sx, ps.sy, facing, 0.92 + pulse * 0.08);

  for (const g of chasers) {
    const gp = poseWorld(maze, g.pose);
    const gs = worldToScreen(map, origin, gp.x, gp.y);
    let color = g.color;
    if (g.state === "frightened") {
      color = frightenedFlash ? "#e8eefc" : "#3b5bdb";
    } else if (g.state === "eaten") {
      color = "#cfd8ff";
    }
    drawChaser(ctx, gs.sx, gs.sy, color, g.state === "eaten");
  }
}

/** Yellow arrowhead runner. */
function drawRunner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  scale: number,
): void {
  const s = 11 * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.75, s * 0.7);
  ctx.lineTo(-s * 0.35, 0);
  ctx.lineTo(-s * 0.75, -s * 0.7);
  ctx.closePath();
  ctx.fillStyle = "#ffd400";
  ctx.fill();
  ctx.strokeStyle = "#1a1400";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** Angular diamond chaser — distinct from arcade ghost silhouettes. */
function drawChaser(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  eyesOnly: boolean,
): void {
  if (!eyesOnly) {
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x + 9, y);
    ctx.lineTo(x, y + 10);
    ctx.lineTo(x - 9, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = eyesOnly ? "#1a1a2e" : "#fff";
  ctx.beginPath();
  ctx.arc(x - 3, y - 1, 2.2, 0, Math.PI * 2);
  ctx.arc(x + 3, y - 1, 2.2, 0, Math.PI * 2);
  ctx.fill();
  if (!eyesOnly) {
    ctx.fillStyle = "#1a1a2e";
    ctx.beginPath();
    ctx.arc(x - 2.5, y - 1, 1, 0, Math.PI * 2);
    ctx.arc(x + 3.5, y - 1, 1, 0, Math.PI * 2);
    ctx.fill();
  }
}
