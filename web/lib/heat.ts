// Heatmap layers and colours for the best-spot survey, shared by the terrain shader and the legend.

export type HeatLayer = "off" | "sun" | "earth" | "both";

/** Ramp ends per layer, sRGB: near-surface dark (0 %) to the layer's data colour (100 %). Sequential,
 * one hue each: Sun amber, Earth blue, both together violet. */
export const HEAT_RAMPS: Record<Exclude<HeatLayer, "off">, [string, string]> = {
  sun: ["#1d1608", "#f6c46a"],
  earth: ["#0c1622", "#9cc3ec"],
  both: ["#150f22", "#c6b3f5"],
};
