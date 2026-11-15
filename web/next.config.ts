import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The dev badge sits over the timeline controls; build errors still show in the overlay.
  devIndicators: false,
  partialPrefetching: true,
  // Big data files are requested as file?v=<content hash> (pipeline/pack_data.py), so they can be
  // cached forever; a changed file gets a new URL. Their small meta/index files stay revalidated.
  // Textures change rarely and carry no hash: a week, then refreshed in the background.
  async headers() {
    const forever = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return [
      { source: "/data/terrain/:area/:file(.*\\.z)", headers: forever },
      { source: "/data/ephemeris/:file(.*\\.bin)", headers: forever },
      { source: "/textures/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
