import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default defineConfig(async (environment) => {
  const config = await (typeof viteConfig === "function" ? viteConfig(environment) : viteConfig);
  return mergeConfig(config, {
    test: {
      // Let jsdom provide browser storage instead of Node's built-in Web Storage globals.
      execArgv: process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
        ? ["--no-experimental-webstorage"]
        : [],
    },
  });
});
