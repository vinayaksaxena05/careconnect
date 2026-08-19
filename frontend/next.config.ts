import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo root (careconnect_final/) has a .git directory one level above
  // this package, which makes Turbopack misinfer the workspace root and
  // fail to resolve dependencies (e.g. tailwindcss) — pin it explicitly.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
