import type { Vec2 } from "../types";
import { dist, lerp } from "./geo";

export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

function inside(p: Vec2, r: Rect): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

/** Liang-Barsky style segment clip against axis-aligned rect. */
function clipSegment(a: Vec2, b: Vec2, r: Rect): [Vec2, Vec2] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  const checks: Array<[number, number]> = [
    [-dx, a.x - r.minX],
    [dx, r.maxX - a.x],
    [-dy, a.y - r.minY],
    [dy, r.maxY - a.y],
  ];

  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }

  return [lerp(a, b, t0), lerp(a, b, t1)];
}

/**
 * Clip a polyline to a rectangle, returning zero or more polylines.
 */
export function clipPolyline(points: Vec2[], rect: Rect): Vec2[][] {
  if (points.length < 2) return [];
  const out: Vec2[][] = [];
  let current: Vec2[] = [];

  const pushCurrent = () => {
    if (current.length >= 2) out.push(current);
    current = [];
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const clipped = clipSegment(a, b, rect);
    if (!clipped) {
      pushCurrent();
      continue;
    }
    const [c0, c1] = clipped;
    if (current.length === 0) {
      current.push(c0, c1);
    } else {
      const last = current[current.length - 1]!;
      if (dist(last, c0) > 0.05) {
        pushCurrent();
        current.push(c0, c1);
      } else {
        current.push(c1);
      }
    }
    // If b is outside, the clipped segment ends on boundary — start fresh next
    if (!inside(b, rect)) pushCurrent();
  }
  pushCurrent();
  return out;
}

export function snapToBoundary(p: Vec2, rect: Rect, eps = 0.75): Vec2 {
  let { x, y } = p;
  if (Math.abs(x - rect.minX) < eps) x = rect.minX;
  if (Math.abs(x - rect.maxX) < eps) x = rect.maxX;
  if (Math.abs(y - rect.minY) < eps) y = rect.minY;
  if (Math.abs(y - rect.maxY) < eps) y = rect.maxY;
  x = Math.max(rect.minX, Math.min(rect.maxX, x));
  y = Math.max(rect.minY, Math.min(rect.maxY, y));
  return { x, y };
}

export function classifyBoundary(
  p: Vec2,
  rect: Rect,
  eps = 1.0,
): "left" | "right" | "top" | "bottom" | null {
  const onLeft = Math.abs(p.x - rect.minX) <= eps;
  const onRight = Math.abs(p.x - rect.maxX) <= eps;
  const onBottom = Math.abs(p.y - rect.minY) <= eps;
  const onTop = Math.abs(p.y - rect.maxY) <= eps;
  // Prefer horizontal/vertical sides over corners for pairing
  if (onLeft && !onTop && !onBottom) return "left";
  if (onRight && !onTop && !onBottom) return "right";
  if (onTop && !onLeft && !onRight) return "top";
  if (onBottom && !onLeft && !onRight) return "bottom";
  if (onLeft) return "left";
  if (onRight) return "right";
  if (onTop) return "top";
  if (onBottom) return "bottom";
  return null;
}
