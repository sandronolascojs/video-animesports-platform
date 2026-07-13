import { defineConfig } from "tsdown";

export default defineConfig({
	entry: "./src/index.ts",
	format: "esm",
	outDir: "./dist",
	clean: true,
	noExternal: [/@video-platform-challenge\/.*/],
	// No declaration output: this is a deployed APP (alchemy bundles src/index.ts
	// itself; nothing imports apps/server's types), and rolldown-plugin-dts can't
	// follow the workspace packages' transitive `export *` barrels anyway (tsc
	// resolves them fine — check-types is the real type gate). Skip the useless
	// .d.ts bundling instead of chasing per-symbol re-export quirks.
	dts: false,
});
