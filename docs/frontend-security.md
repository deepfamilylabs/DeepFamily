# Frontend Security Guide

This document describes the security posture and engineering practices for the DeepFamily frontend (Vite + React). It focuses on protecting **sensitive user inputs** (passphrases, decryption passwords, future BIP39 mnemonic + passphrase) and reducing the **data exfiltration surface** (network egress, CSP, XSS).

## Threat Model (What We Can / Cannot Defend)

### In scope
- Accidental leakage via application code:
  - React state/props, form libraries (`watch`), debug logs, analytics hooks
  - storing secrets in `localStorage` / URL / query params
  - unbounded `connect-src` allowing secrets to be sent to arbitrary origins
- Opportunistic browser exposure:
  - DevTools inspection, common extensions reading DOM/state, crash reports
  - over-permissive CSP enabling inline scripts or `eval`-like execution
- Supply chain and dependency risks (auditing, pinning, upgrades).

### Out of scope / limitations
- **If attacker-controlled JavaScript executes in the page (XSS / compromised dependency)**, it can read input values and intercept worker messages. CSP reduces likelihood/impact but does not make the page “safe” under XSS.
- Browser extensions with broad privileges can observe the DOM and network.
- OS-level malware and malicious browsers.

## Sensitive Inputs: Handling Policy

Treat the following as **sensitive inputs**:
- `passphrase` used for identity hash / proof generation (Add Version / Mint / Key derivation).
- decryption password for metadata bundles (`DecryptMetadataPage`).
- future BIP39 mnemonic + passphrase (planned).

### Policy: “Minimal Exposure Surface” (Scheme B)
Goal: keep secrets **out of React state/props** and minimize copies in memory.

Rules:
- Do not store secrets in component state, context, Redux, URL, or persistent storage.
- Do not include secrets in error objects, telemetry, or `console.*` logs.
- Keep secrets inside the input element (uncontrolled inputs) and read them only at the moment of use via `ref`/imperative handle.
- After use, best-effort clear input values (UX permitting) and clear local variables (best-effort; not a hard guarantee in JS runtimes).

This repo implements Scheme B by keeping passphrases/passwords in uncontrolled inputs and exposing a small imperative API (via `ref`/`useImperativeHandle`) to pull the secret only at submit/proof/encrypt/decrypt time.

## Content Security Policy (CSP)

### Goals
- Prevent inline script execution (`script-src` without `'unsafe-inline'`).
- Prevent runtime string evaluation (`'unsafe-eval'`) in preview/production.
- Constrain network egress (`connect-src`) to known RPC/IPFS/CDN origins where possible.
- Reduce style injection risk (`style-src-attr 'none'` when feasible).

### Operational approach
- Start in `Content-Security-Policy-Report-Only` to collect real violations.
- Fix/whitelist only what is required by real usage.
- Switch preview/production to enforced `Content-Security-Policy` once clean.

## Logging & Error Hygiene

Principle: errors often carry unexpected context. Log only a minimal whitelist.

Guidelines:
- Use a sanitizer for `console.error` in sensitive paths.
- Never log user inputs, derived keys, decrypted payloads, proofs, or intermediate buffers.
- Prefer structured, non-sensitive telemetry fields (e.g., `{ name, message, code }`).

## Storage & Persistence

- Do not persist secrets in `localStorage`, `sessionStorage`, IndexedDB, or Service Worker caches.
- If something must be cached (e.g., ZK verification keys), cache only public artifacts (`.wasm`, `.zkey`, `.vkey.json`) and validate fetch origins with CSP and a strict allowlist.

## Dependency Governance

Minimum practices:
- Keep `package-lock.json` committed and reviewed.
- Run `npm audit` regularly; treat “no fix available” as a risk to isolate/replace rather than ignore.
- Prefer audited, actively maintained crypto and ZK libraries.
- Avoid libraries that rely on `eval`/`new Function` in production builds.

## Workers & Isolation (Recommended)

Moving crypto and ZK into Web Workers:
- reduces main-thread exposure time for secrets (but does not stop XSS),
- prevents UI freezes and improves UX,
- helps avoid accidental logging/state capture in React code.

Implementation note: keep worker code “pure” (no React/DOM imports, no `window`/`document`/storage) and communicate via a minimal message interface. This repo uses dedicated workers for crypto and ZK proof generation/verification.
