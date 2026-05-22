import { defineConfig } from "tsup";

export default defineConfig({
  format: ["esm"],
  dts: true,
  clean: process.env.ARIVIE_SKIP_CLEAN === "1" ? false : true,
  sourcemap: false,
  target: "node20",
  treeshake: true,
  outDir: "dist",
  splitting: false,
  tsconfig: "./tsconfig.json",
});
