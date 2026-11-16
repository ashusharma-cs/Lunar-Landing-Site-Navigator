// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
// Check lib/coords.ts: the parser on the formats the UI accepts (and rejects), and the region lookup:
// every region's own IAU centre must land in an area holding it, points just inside/outside an area
// edge must be classified correctly, and far-away points must be rejected.
// Run: node scripts/check-coords.ts
import { readFileSync } from "node:fs";
import { inArea, parseLatLon, regionFor } from "../lib/coords.ts";
import { destination } from "../lib/terrain.ts";

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fails++;
    console.log("FAIL", msg);
  }
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const good: [string, number, number][] = [
  ["85.963°S 2.382°W", -85.963, -2.382],
  ["85.963 S, 2.382 W", -85.963, -2.382],
  ["85.963S 2.382E", -85.963, 2.382],
  ["-85.963, -2.382", -85.963, -2.382],
  ["-85.963 357.618", -85.963, -2.382],
  ["  -88.3  -34.4 ", -88.3, -34.4],
];
for (const [s, lat, lon] of good) {
  const r = parseLatLon(s);
  ok("lat" in r && near(r.lat, lat) && near(r.lon, lon), `parse "${s}" -> ${JSON.stringify(r)}`);
}
for (const s of ["", "85.9", "abc def", "-85 S 2 W", "95 S 2 W", "85 S 400 E"]) ok("error" in parseLatLon(s), `reject "${s}"`);

const { regions } = JSON.parse(readFileSync("public/data/sites.json", "utf8"));
for (const r of regions) {
  const c = { lat: r.featureLat, lon: r.featureLon };
  const got = regionFor(regions, c, r.id);
  ok(got.region?.id === r.id, `${r.id}: own centre -> ${got.region?.id}`);
  // Due east of the centre, just inside and just outside the area edge.
  const h = r.areaHalfKm * 1000;
  const [la1, lo1] = destination(c.lat, c.lon, 90, h - 500);
  const [la2, lo2] = destination(c.lat, c.lon, 90, h + 500);
  ok(inArea(r, { lat: la1, lon: lo1 }), `${r.id}: 0.5 km inside edge`);
  ok(!inArea(r, { lat: la2, lon: lo2 }), `${r.id}: 0.5 km outside edge`);
}
ok(regionFor(regions, { lat: 0, lon: 0 }).region === null, "equator rejected");
ok(regionFor(regions, { lat: -70, lon: 100 }).region === null, "70°S rejected");

console.log(fails ? `${fails} failures` : `coords: ${good.length} formats parsed, 6 rejected; ${regions.length} regions: centres, area edges (±0.5 km) and far points all correct`);
