import type { LatLng, Vec2 } from "../types";

const R = 6371000;

/** Approximate local tangent-plane projection around an origin. */
export function project(latlng: LatLng, origin: LatLng): Vec2 {
  const latRad = (origin.lat * Math.PI) / 180;
  const x =
    ((latlng.lon - origin.lon) * Math.PI) / 180 * Math.cos(latRad) * R;
  const y = ((latlng.lat - origin.lat) * Math.PI) / 180 * R;
  return { x, y };
}

export function unproject(p: Vec2, origin: LatLng): LatLng {
  const latRad = (origin.lat * Math.PI) / 180;
  const lat = origin.lat + (p.y / R) * (180 / Math.PI);
  const lon =
    origin.lon + (p.x / (R * Math.cos(latRad))) * (180 / Math.PI);
  return { lat, lon };
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Bearing of vector a->b in degrees: 0 east, 90 north (screen-up = +y). */
export function bearingDeg(from: Vec2, to: Vec2): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/** Smallest absolute angle difference in degrees. */
export function angleDiff(a: number, b: number): number {
  let d = ((a - b + 540) % 360) - 180;
  return Math.abs(d);
}

export function desiredDirToBearing(dir: "up" | "down" | "left" | "right"): number {
  switch (dir) {
    case "right":
      return 0;
    case "up":
      return 90;
    case "left":
      return 180;
    case "down":
      return -90;
  }
}

export function pointOnPolyline(points: Vec2[], t: number): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = dist(points[i]!, points[i + 1]!);
    lengths.push(d);
    total += d;
  }
  if (total < 1e-9) return points[0]!;
  let remain = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lengths.length; i++) {
    const seg = lengths[i]!;
    if (remain <= seg || i === lengths.length - 1) {
      const u = seg < 1e-9 ? 0 : remain / seg;
      return lerp(points[i]!, points[i + 1]!, u);
    }
    remain -= seg;
  }
  return points[points.length - 1]!;
}

/** Cumulative lengths along polyline. */
export function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += dist(points[i]!, points[i + 1]!);
  }
  return total;
}

export type PolylineHit = {
  point: Vec2;
  dist: number;
  /** Index of segment start vertex. */
  segIndex: number;
  /** 0..1 along that segment. */
  tSeg: number;
};

/** Closest point on a polyline to p. */
export function closestPointOnPolyline(p: Vec2, points: Vec2[]): PolylineHit {
  if (points.length === 0) {
    return { point: { x: 0, y: 0 }, dist: Infinity, segIndex: 0, tSeg: 0 };
  }
  if (points.length === 1) {
    return {
      point: points[0]!,
      dist: dist(p, points[0]!),
      segIndex: 0,
      tSeg: 0,
    };
  }

  let best: PolylineHit = {
    point: points[0]!,
    dist: Infinity,
    segIndex: 0,
    tSeg: 0,
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-12) {
      t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const point = lerp(a, b, t);
    const d = dist(p, point);
    if (d < best.dist) {
      best = { point, dist: d, segIndex: i, tSeg: t };
    }
  }
  return best;
}

/** Split polyline at closest hit; returns [before including hit, after including hit]. */
export function splitPolylineAt(
  points: Vec2[],
  hit: PolylineHit,
): [Vec2[], Vec2[]] {
  const mid = hit.point;
  const before = [...points.slice(0, hit.segIndex + 1), mid];
  const after = [mid, ...points.slice(hit.segIndex + 1)];
  // If hit is almost at a vertex, avoid duplicate vertex noise
  if (hit.tSeg < 1e-4) {
    return [points.slice(0, hit.segIndex + 1), points.slice(hit.segIndex)];
  }
  if (hit.tSeg > 1 - 1e-4) {
    return [
      points.slice(0, hit.segIndex + 2),
      points.slice(hit.segIndex + 1),
    ];
  }
  return [before, after];
}
