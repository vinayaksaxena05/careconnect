import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo root (careconnect_final/) has a .git directory one level above
  // this package, which makes Turbopack misinfer the workspace root and
  // fail to resolve dependencies (e.g. tailwindcss) — pin it explicitly.
  turbopack: {
    root: path.join(__dirname),
  },
  // Webpack's dev build-worker child processes have been crashing
  // ("Jest worker encountered N child process exceptions") on this
  // machine when compiling client-only routes (e.g. /track/[requestId]
  // with react-leaflet). Force in-process compilation instead of a
  // separate worker pool to eliminate that failure mode.
  experimental: {
    webpackBuildWorker: false,
  },
};

export default nextConfig;
