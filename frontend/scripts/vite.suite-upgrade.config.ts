import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, normalizePath, type Plugin } from "vite";
import frontendConfig from "../vite.config";

// Model a future wallet release with the existing Argon2id parameters. The
// protocol already includes the suite ID in both the salt and the commitment.
const constants = normalizePath(fileURLToPath(new URL("../../packages/protocol-core/constants.js", import.meta.url)));

function upgradeIdentitySuites(): Plugin {
  return {
    name: "browser-acceptance-suite-upgrade",
    enforce: "pre",
    load(id) {
      if (id === constants) {
        // A distinct module ID forwards every other export to the original implementation.
        return `export * from ${JSON.stringify(id + "?original")};
          export const SUPPORTED_IDENTITY_SUITE_IDS = Object.freeze([2, 1]);`;
      }
    },
  };
}

export default defineConfig(async (environment) =>
  mergeConfig(await frontendConfig(environment), {
    plugins: [upgradeIdentitySuites()],
    worker: { plugins: () => [upgradeIdentitySuites()] },
  }),
);
