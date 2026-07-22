import type { Chaser, LatLng, MazeGraph, EdgePose } from "../types";
import { pointOnPolyline, unproject } from "../maze/geo";
import { poseWorld } from "./movement";
import {
  getAppearance,
  lightenHex,
  onAppearanceChange,
  type Appearance,
} from "../ui/appearance";
import type L from "leaflet";

const PLAYER_COLOR = "#EE3325";

export type RenderContext = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  map: L.Map;
  origin: LatLng;
};

const imageCache = new Map<string, HTMLImageElement | null>();

onAppearanceChange(() => {
  // Drop unused entries when prefs change; keep loaded images for current URLs.
  const a = getAppearance();
  for (const key of [...imageCache.keys()]) {
    if (key !== a.playerImage && key !== a.chaserImage) imageCache.delete(key);
  }
});

function getCachedImage(dataUrl: string | null): HTMLImageElement | null {
  if (!dataUrl) return null;
  const existing = imageCache.get(dataUrl);
  if (existing !== undefined) return existing;
  const img = new Image();
  imageCache.set(dataUrl, null);
  img.onload = () => imageCache.set(dataUrl, img);
  img.onerror = () => imageCache.delete(dataUrl);
  img.src = dataUrl;
  return imageCache.get(dataUrl) ?? null;
}

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

/** Facing from a short local sample along the current edge (avoids chord snaps at junctions). */
function localTravelFacing(
  map: L.Map,
  origin: LatLng,
  maze: MazeGraph,
  pose: EdgePose,
): number {
  const e = maze.edges.get(pose.edgeId);
  if (!e || e.points.length < 2) return 0;
  const delta = Math.min(0.04, 4 / Math.max(e.length, 1));
  const t0 = pose.t;
  const t1 = pose.forward
    ? Math.min(1, t0 + delta)
    : Math.max(0, t0 - delta);
  let a = pointOnPolyline(e.points, t0);
  let b = pointOnPolyline(e.points, t1);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 0.05) {
    a = pose.forward ? e.points[0]! : e.points[e.points.length - 1]!;
    b = pose.forward ? e.points[1]! : e.points[e.points.length - 2]!;
  }
  const sa = worldToScreen(map, origin, a.x, a.y);
  const sb = worldToScreen(map, origin, b.x, b.y);
  return Math.atan2(sb.sy - sa.sy, sb.sx - sa.sx);
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
  const appearance = getAppearance();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(0, 0, 8, 0.55)";
  ctx.fillRect(0, 0, w, h);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const paths = [...maze.edges.values()].map((e) =>
    e.points.map((p) => worldToScreen(map, origin, p.x, p.y)),
  );

  strokeAll(ctx, paths, appearance.roadOutline, 18);
  strokeAll(ctx, paths, appearance.roadFill, 12);

  const powerDot = lightenHex(appearance.dot, 0.4);
  for (const pellet of maze.pellets) {
    if (pellet.eaten) continue;
    const s = worldToScreen(map, origin, pellet.x, pellet.y);
    ctx.beginPath();
    ctx.fillStyle = pellet.power ? powerDot : appearance.dot;
    ctx.arc(s.sx, s.sy, pellet.power ? 7 : 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const pp = poseWorld(maze, player);
  const ps = worldToScreen(map, origin, pp.x, pp.y);
  const facing = localTravelFacing(map, origin, maze, player);
  drawPlayer(ctx, ps.sx, ps.sy, facing, 0.92 + pulse * 0.08, appearance);

  for (const g of chasers) {
    const gp = poseWorld(maze, g.pose);
    const gs = worldToScreen(map, origin, gp.x, gp.y);
    drawChaser(ctx, gs.sx, gs.sy, g.state === "frightened", frightenedFlash, appearance);
  }
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  scale: number,
  appearance: Appearance,
): void {
  const custom = getCachedImage(appearance.playerImage);
  if (custom) {
    drawSpriteImage(ctx, custom, x, y, angle, 28 * scale);
    return;
  }
  drawCar(ctx, x, y, angle, scale);
}

/** Top-down car — reads clearly when rotated in any direction. */
function drawCar(
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

  const bodyW = s * 2.05;
  const bodyH = s * 1.15;

  // Wheels
  ctx.fillStyle = "#1a1a1a";
  const wheelW = s * 0.28;
  const wheelH = s * 0.42;
  ctx.fillRect(-bodyW * 0.28, -bodyH * 0.72, wheelW, wheelH);
  ctx.fillRect(bodyW * 0.08, -bodyH * 0.72, wheelW, wheelH);
  ctx.fillRect(-bodyW * 0.28, bodyH * 0.3, wheelW, wheelH);
  ctx.fillRect(bodyW * 0.08, bodyH * 0.3, wheelW, wheelH);

  // Body
  roundRect(ctx, -bodyW * 0.42, -bodyH / 2, bodyW, bodyH, s * 0.28);
  ctx.fillStyle = PLAYER_COLOR;
  ctx.fill();
  ctx.strokeStyle = "#8a1a12";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Cabin / windshield (front faces +x)
  roundRect(ctx, bodyW * 0.02, -bodyH * 0.32, bodyW * 0.28, bodyH * 0.64, s * 0.12);
  ctx.fillStyle = "#2a1010";
  ctx.fill();

  // Rear window
  roundRect(ctx, -bodyW * 0.34, -bodyH * 0.26, bodyW * 0.18, bodyH * 0.52, s * 0.1);
  ctx.fillStyle = "#3a1818";
  ctx.fill();

  // Headlights
  ctx.fillStyle = "#ffe9a8";
  ctx.beginPath();
  ctx.arc(bodyW * 0.52, -bodyH * 0.28, s * 0.12, 0, Math.PI * 2);
  ctx.arc(bodyW * 0.52, bodyH * 0.28, s * 0.12, 0, Math.PI * 2);
  ctx.fill();

  // Taillights
  ctx.fillStyle = "#ff6b5a";
  ctx.fillRect(-bodyW * 0.42, -bodyH * 0.28, s * 0.1, s * 0.18);
  ctx.fillRect(-bodyW * 0.42, bodyH * 0.1, s * 0.1, s * 0.18);

  ctx.restore();
}

function drawChaser(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frightened: boolean,
  flash: boolean,
  appearance: Appearance,
): void {
  const custom = getCachedImage(appearance.chaserImage);
  if (custom && !frightened) {
    drawSpriteImage(ctx, custom, x, y, 0, 26);
    return;
  }
  if (custom && frightened) {
    ctx.save();
    ctx.globalAlpha = flash ? 0.55 : 0.9;
    drawSpriteImage(ctx, custom, x, y, 0, 26);
    ctx.restore();
    return;
  }
  drawCone(ctx, x, y, frightened, flash);
}

function drawSpriteImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  angle: number,
  size: number,
): void {
  const aspect = img.naturalWidth / Math.max(img.naturalHeight, 1);
  const w = aspect >= 1 ? size : size * aspect;
  const h = aspect >= 1 ? size / aspect : size;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** Traffic cone chaser. */
function drawCone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frightened: boolean,
  flash: boolean,
): void {
  const body = frightened ? (flash ? "#e8eefc" : "#3b5bdb") : "#f06020";
  const stripe = frightened ? "#a0a8c0" : "#ffffff";

  ctx.beginPath();
  ctx.moveTo(x, y - 11);
  ctx.lineTo(x + 8, y + 9);
  ctx.lineTo(x - 8, y + 9);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = body;
  ctx.fillRect(x - 9, y + 7, 18, 4);

  ctx.fillStyle = stripe;
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x + 4.5, y + 2);
  ctx.lineTo(x - 4.5, y + 2);
  ctx.closePath();
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
