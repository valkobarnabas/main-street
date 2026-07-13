import L from "leaflet";
import type { ViewBounds } from "../types";

export function createMap(container: HTMLElement): L.Map {
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
  }).setView([40.758, -73.9855], 17);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  return map;
}

/** Geographic bounds of the full visible map. */
export function getViewBounds(map: L.Map): ViewBounds {
  const b = map.getBounds();
  const north = b.getNorth();
  const south = b.getSouth();
  const east = b.getEast();
  const west = b.getWest();
  const midLat = (north + south) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((midLat * Math.PI) / 180);

  return {
    north,
    south,
    east,
    west,
    widthMeters: Math.abs(east - west) * metersPerDegLon,
    heightMeters: Math.abs(north - south) * metersPerDegLat,
  };
}

export function lockMap(map: L.Map, locked: boolean): void {
  if (locked) {
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    map.touchZoom.disable();
  } else {
    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.doubleClickZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
    map.touchZoom.enable();
  }
}
