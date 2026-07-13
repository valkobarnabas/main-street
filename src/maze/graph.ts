import type { GraphEdge, GraphNode, Vec2 } from "../types";
import { classifyBoundary, type Rect, snapToBoundary } from "./clip";
import {
  closestPointOnPolyline,
  dist,
  polylineLength,
  splitPolylineAt,
  type PolylineHit,
} from "./geo";

const SNAP = 8;
const CONNECT = 22;
const STUB_MIN_LENGTH = 32;
const GRID = CONNECT;

export type RawGraph = {
  nodes: Map<number, GraphNode>;
  edges: Map<number, GraphEdge>;
  adj: Map<number, number[]>;
};

function nextId(map: Map<number, unknown>): number {
  let m = 0;
  for (const k of map.keys()) if (k > m) m = k;
  return m + 1;
}

function snapKey(x: number, y: number): string {
  return `${Math.round(x / SNAP)},${Math.round(y / SNAP)}`;
}

export function buildGraph(polylines: Vec2[][], rect: Rect): RawGraph {
  const nodes = new Map<number, GraphNode>();
  const edges = new Map<number, GraphEdge>();
  const adj = new Map<number, number[]>();
  const spatial = new Map<string, number>();
  let nextNode = 1;
  let nextEdge = 1;

  const getOrCreate = (raw: Vec2): number => {
    const p = snapToBoundary(raw, rect);
    const k = snapKey(p.x, p.y);
    const existing = spatial.get(k);
    if (existing != null) return existing;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nk = `${Math.round(p.x / SNAP) + dx},${Math.round(p.y / SNAP) + dy}`;
        const nid = spatial.get(nk);
        if (nid != null) {
          const n = nodes.get(nid)!;
          if (dist(n, p) <= SNAP * 1.15) return nid;
        }
      }
    }

    const id = nextNode++;
    const side = classifyBoundary(p, rect);
    nodes.set(id, {
      id,
      x: p.x,
      y: p.y,
      onBoundary: side != null,
      boundarySide: side,
    });
    spatial.set(k, id);
    adj.set(id, []);
    return id;
  };

  const addEdge = (a: number, b: number, points: Vec2[]) => {
    if (a === b) return;
    const len = polylineLength(points);
    if (len < 1.5) return;
    for (const eid of adj.get(a) ?? []) {
      const e = edges.get(eid)!;
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return;
    }
    const id = nextEdge++;
    edges.set(id, { id, a, b, length: len, points });
    adj.get(a)!.push(id);
    adj.get(b)!.push(id);
  };

  for (const line of polylines) {
    if (line.length < 2) continue;

    const nodeIds: number[] = [];
    const chunks: Vec2[][] = [];
    let chunk: Vec2[] = [line[0]!];
    nodeIds.push(getOrCreate(line[0]!));

    for (let i = 1; i < line.length; i++) {
      const p = line[i]!;
      chunk.push(p);
      const nid = getOrCreate(p);
      const lastId = nodeIds[nodeIds.length - 1]!;
      if (nid !== lastId) {
        nodeIds.push(nid);
        chunks.push(chunk);
        chunk = [p];
      }
    }

    for (let i = 0; i < chunks.length; i++) {
      const pts = chunks[i]!.map((p) => snapToBoundary(p, rect));
      addEdge(nodeIds[i]!, nodeIds[i + 1]!, pts);
    }
  }

  return { nodes, edges, adj };
}

function removeEdge(
  edges: Map<number, GraphEdge>,
  adj: Map<number, number[]>,
  eid: number,
): void {
  const e = edges.get(eid);
  if (!e) return;
  adj.set(
    e.a,
    (adj.get(e.a) ?? []).filter((x) => x !== eid),
  );
  adj.set(
    e.b,
    (adj.get(e.b) ?? []).filter((x) => x !== eid),
  );
  edges.delete(eid);
}

function pruneIsolated(
  nodes: Map<number, GraphNode>,
  adj: Map<number, number[]>,
): void {
  for (const [nid] of [...nodes]) {
    if ((adj.get(nid) ?? []).length === 0) {
      nodes.delete(nid);
      adj.delete(nid);
    }
  }
}

function addEdgeRaw(
  edges: Map<number, GraphEdge>,
  adj: Map<number, number[]>,
  a: number,
  b: number,
  points: Vec2[],
): number | null {
  if (a === b) return null;
  const len = polylineLength(points);
  if (len < 0.5) return null;
  for (const eid of adj.get(a) ?? []) {
    const e = edges.get(eid)!;
    if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return eid;
  }
  const id = nextId(edges);
  edges.set(id, { id, a, b, length: len, points });
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a)!.push(id);
  adj.get(b)!.push(id);
  return id;
}

function updateIncidentPolylines(
  nodes: Map<number, GraphNode>,
  edges: Map<number, GraphEdge>,
  adj: Map<number, number[]>,
  nid: number,
): void {
  const pos = nodes.get(nid)!;
  for (const eid of adj.get(nid) ?? []) {
    const e = edges.get(eid);
    if (!e) continue;
    if (e.a === nid) e.points[0] = { x: pos.x, y: pos.y };
    if (e.b === nid) e.points[e.points.length - 1] = { x: pos.x, y: pos.y };
    e.length = polylineLength(e.points);
  }
}

type SegRef = { eid: number; i: number; a: Vec2; b: Vec2 };

/** Spatial index of edge segments for near-miss queries. */
function buildSegGrid(edges: Map<number, GraphEdge>): Map<string, SegRef[]> {
  const grid = new Map<string, SegRef[]>();
  for (const e of edges.values()) {
    for (let i = 0; i < e.points.length - 1; i++) {
      const a = e.points[i]!;
      const b = e.points[i + 1]!;
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const x0 = Math.floor(minX / GRID);
      const x1 = Math.floor(maxX / GRID);
      const y0 = Math.floor(minY / GRID);
      const y1 = Math.floor(maxY / GRID);
      const ref: SegRef = { eid: e.id, i, a, b };
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const k = `${gx},${gy}`;
          let bucket = grid.get(k);
          if (!bucket) {
            bucket = [];
            grid.set(k, bucket);
          }
          bucket.push(ref);
        }
      }
    }
  }
  return grid;
}

function nearbyEdgeIds(
  grid: Map<string, SegRef[]>,
  p: Vec2,
): Set<number> {
  const gx = Math.floor(p.x / GRID);
  const gy = Math.floor(p.y / GRID);
  const ids = new Set<number>();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(`${gx + dx},${gy + dy}`);
      if (!bucket) continue;
      for (const s of bucket) ids.add(s.eid);
    }
  }
  return ids;
}

/**
 * Link dead-ends that stop short of nearby streets (batched, spatially indexed).
 */
export function connectNearMisses(g: RawGraph, rect: Rect): RawGraph {
  const { nodes, edges, adj } = g;
  const degree = (id: number) => (adj.get(id) ?? []).length;

  // Two passes is enough with a spatial index (was up to 100 full scans).
  for (let pass = 0; pass < 2; pass++) {
    const grid = buildSegGrid(edges);
    type Cand = { nid: number; eid: number; hit: PolylineHit };
    const cands: Cand[] = [];

    for (const nid of nodes.keys()) {
      if (degree(nid) !== 1) continue;
      const node = nodes.get(nid)!;
      const incident = new Set(adj.get(nid) ?? []);
      let best: Cand | null = null;

      for (const eid of nearbyEdgeIds(grid, node)) {
        if (incident.has(eid)) continue;
        const e = edges.get(eid);
        if (!e) continue;
        const hit = closestPointOnPolyline(node, e.points);
        if (hit.dist > CONNECT) continue;
        if (!best || hit.dist < best.hit.dist) best = { nid, eid, hit };
      }
      if (best) cands.push(best);
    }

    cands.sort((a, b) => a.hit.dist - b.hit.dist);
    const usedEdges = new Set<number>();
    const usedNodes = new Set<number>();
    let applied = 0;

    for (const c of cands) {
      if (usedNodes.has(c.nid) || usedEdges.has(c.eid)) continue;
      if (!nodes.has(c.nid) || !edges.has(c.eid)) continue;
      if (degree(c.nid) !== 1) continue;

      const target = edges.get(c.eid)!;
      const node = nodes.get(c.nid)!;
      const na = nodes.get(target.a)!;
      const nb = nodes.get(target.b)!;

      usedNodes.add(c.nid);
      usedEdges.add(c.eid);

      const endA = dist(c.hit.point, na) <= SNAP * 1.25;
      const endB = dist(c.hit.point, nb) <= SNAP * 1.25;
      if (endA || endB) {
        const keep = endA ? target.a : target.b;
        if (keep !== c.nid) mergeNodes(nodes, edges, adj, c.nid, keep);
        applied++;
        continue;
      }

      const [leftPts, rightPts] = splitPolylineAt(target.points, c.hit);
      const a = target.a;
      const b = target.b;
      removeEdge(edges, adj, c.eid);

      node.x = c.hit.point.x;
      node.y = c.hit.point.y;
      const side = classifyBoundary(node, rect);
      node.onBoundary = side != null;
      node.boundarySide = side;
      updateIncidentPolylines(nodes, edges, adj, c.nid);

      addEdgeRaw(edges, adj, a, c.nid, leftPts);
      addEdgeRaw(edges, adj, c.nid, b, rightPts);
      applied++;
    }

    if (applied === 0) break;
  }

  pruneIsolated(nodes, adj);
  return { nodes, edges, adj };
}

function mergeNodes(
  nodes: Map<number, GraphNode>,
  edges: Map<number, GraphEdge>,
  adj: Map<number, number[]>,
  from: number,
  into: number,
): void {
  if (from === into || !nodes.has(from) || !nodes.has(into)) return;
  const intoPos = nodes.get(into)!;

  for (const eid of [...(adj.get(from) ?? [])]) {
    const e = edges.get(eid);
    if (!e) continue;
    removeEdge(edges, adj, eid);
    const other = e.a === from ? e.b : e.a;
    if (other === into) continue;
    const pts =
      e.a === from
        ? [{ x: intoPos.x, y: intoPos.y }, ...e.points.slice(1)]
        : [...e.points.slice(0, -1), { x: intoPos.x, y: intoPos.y }];
    if (e.a === from) addEdgeRaw(edges, adj, into, e.b, pts);
    else addEdgeRaw(edges, adj, e.a, into, pts);
  }

  nodes.delete(from);
  adj.delete(from);
}

/** Drop short dead-end spurs. */
export function pruneStubs(g: RawGraph, minLength = STUB_MIN_LENGTH): RawGraph {
  const { nodes, edges, adj } = g;
  const degree = (id: number) => (adj.get(id) ?? []).length;

  let changed = true;
  while (changed) {
    changed = false;
    for (const [eid, e] of [...edges]) {
      if (e.length >= minLength) continue;
      const da = degree(e.a);
      const db = degree(e.b);
      if (da !== 1 && db !== 1) continue;
      removeEdge(edges, adj, eid);
      changed = true;
    }
    if (changed) pruneIsolated(nodes, adj);
  }

  return { nodes, edges, adj };
}

/** Merge near-collinear degree-2 nodes (many per pass). */
export function simplifyGraph(g: RawGraph): RawGraph {
  const { nodes, edges, adj } = g;
  const degree = (id: number) => (adj.get(id) ?? []).length;

  let changed = true;
  while (changed) {
    changed = false;
    for (const [nid, node] of [...nodes]) {
      if (!nodes.has(nid)) continue;
      if (node.onBoundary) continue;
      if (degree(nid) !== 2) continue;

      const [e1id, e2id] = adj.get(nid)!;
      const e1 = edges.get(e1id);
      const e2 = edges.get(e2id);
      if (!e1 || !e2) continue;
      const other1 = e1.a === nid ? e1.b : e1.a;
      const other2 = e2.a === nid ? e2.b : e2.a;
      if (other1 === other2) continue;
      if (!nodes.has(other1) || !nodes.has(other2)) continue;

      const pts1 =
        e1.a === nid ? [...e1.points].reverse() : [...e1.points];
      const pts2 =
        e2.a === nid ? [...e2.points] : [...e2.points].reverse();
      const merged = [...pts1.slice(0, -1), ...pts2];

      removeEdge(edges, adj, e1id);
      removeEdge(edges, adj, e2id);
      nodes.delete(nid);
      adj.delete(nid);

      if (polylineLength(merged) >= 1.5) {
        addEdgeRaw(edges, adj, other1, other2, merged);
      }
      changed = true;
    }
  }

  pruneIsolated(nodes, adj);
  return { nodes, edges, adj };
}

export function largestComponent(g: RawGraph): RawGraph {
  const visited = new Set<number>();
  let best: number[] = [];

  for (const start of g.nodes.keys()) {
    if (visited.has(start)) continue;
    const stack = [start];
    const comp: number[] = [];
    visited.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const eid of g.adj.get(n) ?? []) {
        const e = g.edges.get(eid)!;
        const o = e.a === n ? e.b : e.a;
        if (!visited.has(o)) {
          visited.add(o);
          stack.push(o);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }

  const keep = new Set(best);
  const nodes = new Map<number, GraphNode>();
  const edges = new Map<number, GraphEdge>();
  const adj = new Map<number, number[]>();

  for (const id of keep) {
    nodes.set(id, g.nodes.get(id)!);
    adj.set(id, []);
  }
  for (const [eid, e] of g.edges) {
    if (keep.has(e.a) && keep.has(e.b)) {
      edges.set(eid, e);
      adj.get(e.a)!.push(eid);
      adj.get(e.b)!.push(eid);
    }
  }
  return { nodes, edges, adj };
}
