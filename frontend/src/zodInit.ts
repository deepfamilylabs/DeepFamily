import { config as zodCoreConfig } from "zod/v4/core";

// Disable Zod v4 JIT fastpass globally to avoid runtime code-generation probes under strict CSP.
// It must run before any schema is constructed; vite.config.ts bundles it into zod's chunk.
zodCoreConfig({ jitless: true });
