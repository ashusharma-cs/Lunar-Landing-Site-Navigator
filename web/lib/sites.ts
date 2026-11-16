// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
import meta from "@/public/data/sites.json";

/** NASA candidate landing region for the crewed south-pole landing (Artemis IV; announced Oct 2024 for Artemis III). NASA has published no coordinates and has not chosen
 * landing points, so a region is anchored to the IAU feature it is named after (official centre and
 * diameter) and comes with a terrain area around it (`terrainId`); points are analysed only where the
 * user picks them. */
export type Region = {
  id: string;
  name: string;
  feature: string;
  featureLat: number;
  featureLon: number;
  featureDiameterKm: number;
  featureType: string;
  featureUrl: string;
  terrainId: string;
  areaHalfKm: number;
  farHalfKm: number;
  source: string;
  sourceUrl: string;
};

export const OBSERVER_HEIGHT_M = meta.observerHeightM;
export const regions = meta.regions as Region[];

export function getRegion(id: string): Region | undefined {
  return regions.find((r) => r.id === id);
}

export function formatLatLon(lat: number, lon: number, digits = 2) {
  const l = ((lon + 540) % 360) - 180;
  return `${Math.abs(lat).toFixed(digits)}°${lat < 0 ? "S" : "N"}  ${Math.abs(l).toFixed(digits)}°${l < 0 ? "W" : "E"}`;
}
