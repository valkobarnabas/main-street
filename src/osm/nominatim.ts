import type { LatLng } from "../types";

export type SearchResult = {
  displayName: string;
  lat: number;
  lon: number;
};

/**
 * Dev: Vite proxy with identifying User-Agent.
 * Production (GitHub Pages): talk to Nominatim directly (CORS-enabled).
 */
function nominatimUrl(path: string): URL {
  if (import.meta.env.DEV) {
    return new URL(`/api/nominatim${path}`, window.location.origin);
  }
  return new URL(`https://nominatim.openstreetmap.org${path}`);
}

export async function searchPlace(query: string): Promise<SearchResult[]> {
  const url = nominatimUrl("/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = (await res.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
  }>;
  return data.map((d) => ({
    displayName: d.display_name,
    lat: Number(d.lat),
    lon: Number(d.lon),
  }));
}

export async function reverseGeocode(ll: LatLng): Promise<string | null> {
  const url = nominatimUrl("/reverse");
  url.searchParams.set("lat", String(ll.lat));
  url.searchParams.set("lon", String(ll.lon));
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { display_name?: string };
  return data.display_name ?? null;
}
