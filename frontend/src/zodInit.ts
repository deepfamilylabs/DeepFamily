import { config as zodCoreConfig } from 'zod/v4/core'

// Disable Zod v4 JIT fastpass globally to avoid runtime `new Function(...)` probes under strict CSP.
zodCoreConfig({ jitless: true })
