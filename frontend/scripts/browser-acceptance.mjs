#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { DOMAIN_SUITE, decodeShieldedReceiveCredential, wrapIdentityCommitmentAsPersonHash } from "@deepfamily/protocol-core";
import { poseidon4 } from "poseidon-lite";
import { deployIntegratedSystem } from "../../hardhat/integratedDeployment.mjs";
import seedHelpers from "../../lib/seedHelpers.js";
import { verificationPaths } from "../../scripts/lib/verificationPaths.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const frontend = path.join(root, "frontend");
const output = verificationPaths(root).browserAcceptance;
const dist = path.join(frontend, ".browser-acceptance/dist");
const vite = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vite/package.json")),
  "bin/vite.js",
);
const report = {
  schema: "deepfamily/browser-acceptance@1",
  scope: "isolated-local-evm",
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  transactions: [],
};
const pages = [];
const servers = [];
let browser, connection;

async function until(read, accept, label, timeout = 240_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
async function availablePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
async function capture(page, name) {
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}
function startVite(args, env) {
  const log = createWriteStream(path.join(output, "vite.log"), { flags: "a" });
  const child = spawn(process.execPath, [vite, ...args], { cwd: frontend, env });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.once("close", () => log.end());
  return child;
}
async function serveFrontend(env, directory, config) {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const rpcUrl = `${baseUrl}/__browser-acceptance/rpc`;
  const buildEnv = { ...env, VITE_RPC_URL: rpcUrl };
  const build = startVite(
    ["build", "--outDir", directory, "--emptyOutDir", ...(config ? ["--config", config] : [])],
    buildEnv,
  );
  assert.equal(
    await new Promise((resolve, reject) => {
      build.once("error", reject);
      build.once("exit", resolve);
    }),
    0,
    "Browser acceptance build failed; see vite.log",
  );
  const server = startVite(
    ["preview", "--outDir", directory, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    buildEnv,
  );
  servers.push(server);
  await until(
    async () => {
      try {
        return (await fetch(baseUrl)).ok;
      } catch {
        return false;
      }
    },
    Boolean,
    "preview server",
  );
  return { baseUrl, rpcUrl };
}
async function click(button) {
  await button.waitFor({ state: "visible" });
  await until(() => button.isEnabled(), Boolean, "button enabled");
  await button.click();
}
const task = (page, name) =>
  page
    .getByRole("navigation", { name: "Assets and budgets" })
    .getByRole("button", { name, exact: true });
async function choose(page, button, name) {
  await click(button);
  await page.getByRole("option", { name, exact: true }).click();
}
async function idle(page) {
  await until(
    () => page.getByRole("button", { name: "Refresh", exact: true }).isEnabled(),
    Boolean,
    "asset recovery settled",
  );
}
async function refresh(page) {
  await click(page.getByRole("button", { name: "Refresh", exact: true }));
  await idle(page);
}

async function openPage(label, url, address, rpcUrl, reader, rootHash, language = "en") {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    locale: language === "en" ? "en-US" : language,
    serviceWorkers: "block",
    ...(process.env.BROWSER_ACCEPTANCE_VIDEO === "1" ? { recordVideo: { dir: output } } : {}),
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const bridge = { account: address, chainId: "0x7a69", holdNext: false, pending: null };
  await context.route(rpcUrl, async (route) => {
    const handle = async ({ id, method, params = [] }) => {
      try {
        return {
          jsonrpc: "2.0",
          id,
          result: await connection.provider.request({ method, params }),
        };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: error.code ?? -32000,
            message: "Local acceptance RPC rejected the call",
            ...(error.data ? { data: error.data } : {}),
          },
        };
      }
    };
    const request = route.request().postDataJSON();
    const response = Array.isArray(request)
      ? await Promise.all(request.map(handle))
      : await handle(request);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  pages.push({ label, page, context, bridge });
  await page.exposeBinding(
    "__acceptanceWalletRequest",
    async (_source, { method, params = [] }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [bridge.account];
      if (method === "eth_chainId") return bridge.chainId;
      if (method === "wallet_requestPermissions" || method === "wallet_getPermissions")
        return [{ parentCapability: "eth_accounts" }];
      if (method === "wallet_switchEthereumChain") {
        assert.equal(BigInt(params[0].chainId), 31337n);
        return null;
      }
      if (method === "eth_sendTransaction") {
        const account = bridge.account,
          chainId = bridge.chainId;
        assert.equal(params[0].from.toLowerCase(), account.toLowerCase());
        assert.equal(chainId, "0x7a69");
        if (bridge.holdNext) {
          bridge.holdNext = false;
          await new Promise((resolve) => {
            bridge.pending = resolve;
          });
          bridge.pending = null;
          if (bridge.account !== account || bridge.chainId !== chainId)
            return { __acceptanceWalletError: { message: "Wallet context changed", code: 4001 } };
        }
        const hash = await connection.provider.request({ method, params });
        report.transactions.push({ label, hash, to: params[0].to });
        return hash;
      }
      assert(!/sign|sendRawTransaction/i.test(method), `Unexpected signing method: ${method}`);
      return connection.provider.request({ method, params });
    },
  );
  await page.addInitScript(
    ({ rpcUrl, reader, rootHash, language }) => {
      localStorage.setItem("i18nextLng", language);
      if (!localStorage.getItem("ft:config"))
        localStorage.setItem(
          "ft:config",
          JSON.stringify({
            rpcUrl,
            chainId: 31337,
            readerAddress: reader,
            rootHash,
            rootVersionIndex: 1,
          }),
        );
      const listeners = new Map();
      window.ethereum = {
        isMetaMask: true,
        isConnected: () => true,
        request: async (args) => {
          const result = await window.__acceptanceWalletRequest(args);
          if (result?.__acceptanceWalletError)
            throw Object.assign(
              new Error(result.__acceptanceWalletError.message),
              result.__acceptanceWalletError,
            );
          return result;
        },
        on: (event, fn) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event).add(fn);
        },
        removeListener: (event, fn) => listeners.get(event)?.delete(fn),
      };
      window.__acceptanceWalletChange = ({ account, chainId }) => {
        if (account) for (const fn of listeners.get("accountsChanged") ?? []) fn([account]);
        if (chainId) for (const fn of listeners.get("chainChanged") ?? []) fn(chainId);
      };
    },
    { rpcUrl, reader, rootHash, language },
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const connect = page.getByRole("button", { name: language === "zh-CN" ? "连接钱包" : "Connect Wallet", exact: true }).first();
  await click(connect);
  return { page, bridge };
}

async function fillIdentity(scope, identity) {
  for (const field of ["fullName", "birthYear", "birthMonth", "birthDay"])
    await scope.locator(`input[name="${field}"]`).first().fill(String(identity[field]));
  for (const input of await scope.locator('input[type="password"]').all())
    await input.fill(identity.passphrase);
}

async function verifyLateVersionReceipt(page, family, original) {
  const dialog = page.getByRole("dialog");
  const closeForm = async () => {
    await click(dialog.getByRole("button", { name: "Close", exact: true }).first());
    await dialog.waitFor({ state: "hidden" });
  };
  const openForm = () => click(page.getByRole("button", { name: /Start Adding Version/ }));
  const retired = { ...original, fullName: "Browser Acceptance Retired Draft" };
  const next = { ...original, fullName: "Browser Acceptance Unsent Draft" };
  await closeForm();
  await openForm();
  await fillIdentity(dialog.getByRole("region", { name: "Person Information" }), retired);
  for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
  await click(dialog.getByRole("button", { name: "Add Version", exact: true }));
  const approve = dialog.getByRole("button", { name: "Continue to Wallet", exact: true });
  await approve.waitFor();
  const before = report.transactions.length;
  let originalTx;
  await connection.provider.request({ method: "evm_setAutomine", params: [false] });
  try {
    await click(approve);
    originalTx = await until(() => report.transactions[before], Boolean, "original draft broadcast");
    assert.equal(await connection.ethers.provider.getTransactionReceipt(originalTx.hash), null);
    await closeForm();
    await openForm();
    await fillIdentity(dialog.getByRole("region", { name: "Person Information" }), next);
    await connection.provider.request({ method: "evm_mine" });
  } finally {
    await connection.provider.request({ method: "evm_setAutomine", params: [true] });
  }
  const centre = page.getByTitle("Transactions", { exact: true });
  await until(() => centre.textContent(), text => /:\s*2\s*$/.test(text), "both transaction records settled");
  assert.equal(await dialog.locator('input[name="fullName"]').first().inputValue(), next.fullName);
  assert.equal(await dialog.getByRole("heading", { name: "Version Added Successfully" }).count(), 0);
  assert.equal(report.transactions.length, before + 1);
  assert.equal(await family.personVersionsCount(await seedHelpers.computePersonHash({ personData: retired })), 1n);
  assert.equal(await family.personVersionsCount(await seedHelpers.computePersonHash({ personData: next })), 0n);
  await capture(page, "new-draft-after-original-receipt");
  await closeForm();
  await click(centre);
  const row = page.getByRole("dialog", { name: "Transactions" }).getByRole("listitem").filter({
    hasText: `${originalTx.hash.slice(0, 10)}…${originalTx.hash.slice(-8)}`,
  });
  await row.getByText("Transaction successful", { exact: true }).waitFor();
  report.checks.push({ label: "late-receipt-only-settles-original-draft", status: "passed", transactionHash: originalTx.hash });
}
async function unlockIdentity(page, identity) {
  await page.locator('input[name="fullName"]').waitFor();
  await fillIdentity(page, identity);
  await click(page.getByRole("button", { name: "Unlock identity", exact: true }));
  await task(page, "Deposit").waitFor();
  await idle(page);
}
async function unlock(page, identity) {
  await unlockIdentity(page, identity);
  await choose(page, page.getByRole("button", { name: /^Asset DEEP$/ }), "ETH");
  await idle(page);
}

async function checkClaimedBalances(page) {
  const balances = page.getByRole("group", { name: "Identity credentials", exact: true }).locator("dd");
  await until(
    async () => (await balances.allTextContents()).map((value) => value.replace(/\s/g, "")),
    (values) => values[0] === "0.003ETH" && values[1] === "0.006ETH",
    "claimed VALUE and remaining budget balances",
  );
}

function protocolButton(scope) {
  return scope.getByRole("button", { name: /^Identity protocol \d/ });
}
async function selectProtocol(scope, suite, outcome) {
  await click(protocolButton(scope));
  const option = scope.getByRole("option", { name: new RegExp(`^Identity protocol ${suite}\\b`) });
  if (outcome) await option.getByText(outcome, { exact: false }).waitFor();
  await option.click();
}

async function checkIdentitySuiteUpgrade({ env, baseline, address, reader, rootHash, child, registration, deployed, signer }) {
  const family = await deployed.deepFamily.getAddress();
  const createPath = "/create?tab=add-version&open=1";
  const { page: prior } = await openPage("suite-1-record", baseline.baseUrl + createPath, address, baseline.rpcUrl, reader, rootHash);
  const priorForm = prior.getByRole("region", { name: "Person Information" });
  await fillIdentity(priorForm, child);
  assert.equal(await protocolButton(priorForm).count(), 0);
  await addVersion(prior, "original-client-adds-second-version", family);
  assert.equal(await deployed.deepFamily.personVersionsCount(registration.personHash), 2n);

  const legacy = { ...child, fullName: "Browser Acceptance Unregistered Legacy Wallet" };
  const legacyHash = await seedHelpers.computePersonHash({ personData: legacy });
  assert.equal(await deployed.deepFamily.personVersionsCount(legacyHash), 0n);
  const { page: original } = await openPage("legacy-local", `${baseline.baseUrl}/inheritance`, address, baseline.rpcUrl, reader, rootHash);
  await unlock(original, legacy);
  await task(original, "Deposit").click();
  await original.getByRole("textbox", { name: "Amount (ETH)", exact: true }).fill("0.02");
  const depositBefore = report.transactions.length;
  await click(original.getByRole("button", { name: "Confirm Deposit", exact: true }));
  await confirmed(original, "unregistered-suite-1-deposit", depositBefore, await deployed.shieldedNativePool.getAddress());
  const { baseUrl, rpcUrl } = await serveFrontend(
    env,
    path.join(frontend, ".browser-acceptance/suite-upgrade"),
    "scripts/vite.suite-upgrade.config.ts",
  );
  const { page } = await openPage("suite-upgrade", `${baseUrl}/inheritance`, address, rpcUrl, reader, rootHash);
  const walletHash = page.getByText("Person hash", { exact: true }).locator("..").locator("code");
  // With several suites, the overview names the protocol of the wallet that is open.
  const walletProtocol = (target, suite) =>
    target.getByText("Person hash", { exact: true }).locator("..").getByText(`Identity protocol ${suite}`, { exact: true });
  const before = report.transactions.length;

  // Public reference hash calculated with suite 2 in the Argon2id salt and the circuit commitment.
  const newUser = { ...child, fullName: "Browser Acceptance New Identity" };
  const newUserSuite2Hash = "0xad237324512c990603c9bf7888ff85976dc65978e5f25c68668de9923886b95c";
  const newUserSuite1Hash = await seedHelpers.computePersonHash({ personData: newUser });
  assert.notEqual(newUserSuite2Hash, newUserSuite1Hash);
  for (const hash of [newUserSuite2Hash, newUserSuite1Hash]) {
    assert.equal(await deployed.deepFamily.personVersionsCount(hash), 0n);
  }
  await unlockIdentity(page, newUser);
  assert.equal(await walletHash.getAttribute("title"), newUserSuite2Hash, "A new identity uses the upgraded default");
  await walletProtocol(page, 2).waitFor();
  const credential = decodeShieldedReceiveCredential(await receiveCode(page));
  assert.equal(wrapIdentityCommitmentAsPersonHash(credential.identityCommitment), newUserSuite2Hash);
  report.checks.push({
    label: "unregistered-identity-defaults-to-suite-2",
    status: "passed",
    personHash: newUserSuite2Hash,
  });

  await click(page.getByRole("button", { name: "Lock", exact: true }));
  const record = await deployed.lineageIndex.versionParents(registration.personHash, 1);
  assert.equal(record.identitySuiteId, 1n);
  await unlock(page, child);
  assert.equal(
    await walletHash.getAttribute("title"),
    registration.personHash,
    "The registered suite-1 identity is reopened",
  );
  await walletProtocol(page, 1).waitFor();
  await checkClaimedBalances(page);
  assert.equal(report.transactions.length, before, "Discovering the old identity requires no wallet transaction");
  report.checks.push({
    label: "suite-2-wallet-recovers-registered-suite-1-identity",
    status: "passed",
    personHash: registration.personHash,
    registrationTransaction: registration.transactionHash,
    available: "0.003",
    budget: "0.006",
    symbol: "ETH",
  });
  await capture(page, "suite-2-wallet-with-suite-1-balances");

  const { page: recovered } = await openPage("legacy-recovered", `${baseUrl}/inheritance`, address, rpcUrl, reader, rootHash);
  await unlock(recovered, legacy);
  await recovered.getByTitle(legacyHash, { exact: true }).waitFor();
  const balance = recovered.getByRole("group", { name: "Identity credentials", exact: true }).locator("dd").first();
  await until(() => balance.textContent(), text => text.replace(/\s/g, "") === "0.02ETH", "unregistered pre-upgrade balance");
  assert.equal(await deployed.deepFamily.personVersionsCount(legacyHash), 0n);
  assert.equal(report.transactions.length, before);
  report.checks.push({ label: "unregistered-suite-1-balance-recovered-on-fresh-suite-2-client", status: "passed", personHash: legacyHash, available: "0.02", symbol: "ETH" });

  const { page: create } = await openPage("mixed-suite-version", `${baseUrl}/create?tab=add-version&open=1`, address, rpcUrl, reader, rootHash);
  const dialog = create.getByRole("dialog");
  const newPerson = dialog.getByRole("region", { name: "Person Information" });
  const passphraseLabel = newPerson.locator("label").filter({ hasText: /^Identity passphrase$/ });
  await passphraseLabel.locator("..").getByRole("button", { name: "Identity protocol 2", exact: true }).waitFor();
  assert.equal(await protocolButton(dialog).count(), 1, "Only the expanded role offers a protocol selector");
  await fillIdentity(newPerson, newUser);
  const fatherButton = dialog.getByRole("button", { name: /Father Information/ });
  await click(fatherButton);
  const fatherForm = fatherButton.locator("..");
  await choose(create, fatherForm.getByRole("button", { name: "Male", exact: true }), "Unknown");
  await fillIdentity(fatherForm, child);
  await selectProtocol(fatherForm, 1, "Reference the existing father’s record");
  await fatherForm.getByRole("button", { name: /^Version 1/ }).waitFor();
  // Switching back to an identity without a record clears the old parent version.
  await selectProtocol(fatherForm, 2, "Reference this identity as the father");
  await fatherForm.getByRole("button", { name: "Unknown (0)", exact: true }).waitFor();
  await selectProtocol(fatherForm, 1, "Reference the existing father’s record");
  const motherButton = dialog.getByRole("button", { name: /Mother Information/ });
  await click(motherButton);
  const motherForm = motherButton.locator("..");
  await choose(create, motherForm.getByRole("button", { name: "Female", exact: true }), "Unknown");
  await fillIdentity(motherForm, legacy);
  await motherForm.getByRole("button", { name: "Identity protocol 2 (older activity found)", exact: true }).waitFor();
  await selectProtocol(motherForm, 1, "She has no record yet");
  await addVersion(create, "suite-2-version-with-suite-1-parent", family);
  const mixed = await deployed.lineageIndex.versionParents(newUserSuite2Hash, 1);
  assert.equal(mixed.identitySuiteId, 2n);
  assert.equal(mixed.fatherIdentityCommitment, registration.identityCommitment);
  assert.equal(wrapIdentityCommitmentAsPersonHash(mixed.motherIdentityCommitment), legacyHash);
  const version = await deployed.deepFamily.personVersionAt(newUserSuite2Hash, 0);
  assert.equal(version.fatherVersionIndex, 1n);
  assert.equal(version.motherVersionIndex, 0n);

  const { page: returning } = await openPage("returning-default", baseUrl + createPath, address, rpcUrl, reader, rootHash);
  const returningPerson = returning.getByRole("region", { name: "Person Information" });
  await fillIdentity(returningPerson, child);
  await click(returningPerson.getByRole("button", { name: "Identity protocol 2 (older activity found)", exact: true }));
  const current = returningPerson.getByRole("option", { name: /Identity protocol 2.*Create a separate person record/ });
  await current.waitFor();
  assert.equal(await current.getAttribute("aria-selected"), "true");
  await returningPerson.getByRole("option", { name: /Identity protocol 1.*Add to the existing person record/ }).waitFor();
  await capture(returning, "identity-protocol-menu");
  await returning.keyboard.press("Escape");
  const otherHash = await returningPerson.getByText(/^0x[0-9a-f]{64}$/i).innerText();
  assert.notEqual(otherHash, registration.personHash);
  await addVersion(returning, "returning-person-defaults-to-independent-suite-2-record", family);
  assert.equal(await deployed.deepFamily.personVersionsCount(registration.personHash), 2n);
  assert.equal(await deployed.deepFamily.personVersionsCount(otherHash), 1n);
  assert.equal((await deployed.lineageIndex.versionParents(otherHash, 1)).identitySuiteId, 2n);

  const { page: existing } = await openPage("returning-suite-1-person", baseUrl + createPath, address, rpcUrl, reader, rootHash);
  const existingPerson = existing.getByRole("region", { name: "Person Information" });
  await fillIdentity(existingPerson, child);
  await existingPerson.getByTitle(otherHash, { exact: true }).waitFor();
  await selectProtocol(existingPerson, 1, "Add to the existing person record");
  await existingPerson.getByTitle(registration.personHash, { exact: true }).waitFor();
  await addVersion(existing, "returning-person-selects-original-suite-1-record", family);
  assert.equal(await deployed.deepFamily.personVersionsCount(registration.personHash), 3n);
  assert.equal((await deployed.lineageIndex.versionParents(registration.personHash, 3)).identitySuiteId, 1n);
  assert.equal(await deployed.deepFamily.personVersionsCount(otherHash), 1n);
  assert.equal((await deployed.deepFamily.personVersionAt(newUserSuite2Hash, 0)).fatherHash, registration.personHash);

  // This parent previously appeared only inside someone else's suite-1 family record.
  const parentOnly = { ...child, fullName: "Browser Acceptance Parent With No Own Version" };
  const parentOnlyHash = await seedHelpers.computePersonHash({ personData: parentOnly });
  await seedHelpers.addPersonVersion({
    deepFamily: deployed.deepFamily, signer,
    personData: { ...child, fullName: "Browser Acceptance Legacy Child Of Unregistered Parent" },
    motherData: parentOnly, motherVersion: 0,
  });
  assert.equal(await deployed.deepFamily.personVersionsCount(parentOnlyHash), 0n);
  assert.equal(await deployed.deepFamily.childrenCount(parentOnlyHash, 0), 1n);
  const { page: referenced } = await openPage("referenced-suite-1-parent", `${baseUrl}/create?tab=add-version&open=1`, address, rpcUrl, reader, rootHash);
  const referencedPerson = referenced.getByRole("region", { name: "Person Information" });
  await fillIdentity(referencedPerson, parentOnly);
  await selectProtocol(referencedPerson, 1, "Previously referenced by a child");
  await addVersion(referenced, "previously-referenced-parent-gets-first-version-at-original-suite-1-hash", family);
  assert.equal((await deployed.lineageIndex.versionParents(parentOnlyHash, 1)).identitySuiteId, 1n);

  // A user can have activity under both IDs. A registered identity must not mask an older funded wallet.
  const { page: secondDeposit } = await openPage("dual-suite-deposit", `${baseline.baseUrl}/inheritance`, address, baseline.rpcUrl, reader, rootHash);
  await unlock(secondDeposit, newUser);
  await task(secondDeposit, "Deposit").click();
  await secondDeposit.getByRole("textbox", { name: "Amount (ETH)", exact: true }).fill("0.001");
  const beforeSecondDeposit = report.transactions.length;
  await click(secondDeposit.getByRole("button", { name: "Confirm Deposit", exact: true }));
  await confirmed(secondDeposit, "suite-1-deposit-for-dual-suite-user", beforeSecondDeposit, await deployed.shieldedNativePool.getAddress());
  assert.equal(await deployed.deepFamily.personVersionsCount(newUserSuite1Hash), 0n);

  const { page: both } = await openPage("dual-suite-wallet", `${baseUrl}/inheritance`, address, rpcUrl, reader, rootHash);
  await fillIdentity(both, newUser);
  await click(both.getByRole("button", { name: "Unlock identity", exact: true }));
  const chooser = both.getByRole("dialog", { name: "Choose the identity to unlock" });
  // Each choice says in words why it is offered.
  await chooser.getByRole("button", { name: `Identity protocol 2 · Has a person record ${newUserSuite2Hash}`, exact: true }).waitFor();
  await click(chooser.getByRole("button", { name: `Identity protocol 1 · Has wallet activity ${newUserSuite1Hash}`, exact: true }));
  await both.getByTitle(newUserSuite1Hash, { exact: true }).waitFor();
  await walletProtocol(both, 1).waitFor();
  await choose(both, both.getByRole("button", { name: /^Asset DEEP$/ }), "ETH");
  const selectedBalance = both.getByRole("group", { name: "Identity credentials", exact: true }).locator("dd").first();
  await until(() => selectedBalance.textContent(), text => text.replace(/\s/g, "") === "0.001ETH", "selected suite-1 balance");
  report.checks.push({ label: "registered-suite-2-and-unregistered-funded-suite-1-offered-together", status: "passed" });

  // A payer who generates a code from someone's credentials is offered the wallets that person's unlock offers.
  const beforeRecipient = report.transactions.length;
  await click(task(both, "Transfer"));
  await click(both.getByRole("radio", { name: "Generate the recipient's code for them", exact: true }));
  await fillIdentity(both, newUser);
  await click(both.getByRole("button", { name: "Generate receive code", exact: true }));
  const recipientChooser = both.getByRole("dialog", { name: "Choose the recipient’s identity" });
  await recipientChooser.getByRole("button", { name: `Identity protocol 1 · Has wallet activity ${newUserSuite1Hash}`, exact: true }).waitFor();
  await click(recipientChooser.getByRole("button", { name: `Identity protocol 2 · Has a person record ${newUserSuite2Hash}`, exact: true }));
  const recipientCode = both.getByRole("textbox", { name: "Recipient's receive code", exact: true });
  await until(() => recipientCode.inputValue(), (value) => value.startsWith("dfrecv"), "receive code for the chosen recipient identity");
  assert.equal(report.transactions.length, beforeRecipient, "Looking up a recipient requires no wallet transaction");
  report.checks.push({ label: "recipient-credentials-offer-the-identities-their-unlock-offers", status: "passed" });

  const { page: ambiguous } = await openPage("add-version-multiple-identities", `${baseUrl}/create?tab=add-version&open=1`, address, rpcUrl, reader, rootHash);
  const person = ambiguous.getByRole("region", { name: "Person Information" });
  await fillIdentity(person, newUser);
  await click(person.getByRole("button", { name: "Identity protocol 2 (older activity found)", exact: true }));
  await person.getByRole("option", { name: /Identity protocol 1.*Create a separate person record/ }).waitFor();
  assert.equal(await person.getByRole("option", { name: /Identity protocol 2.*Add to the existing person record/ }).getAttribute("aria-selected"), "true");
  await ambiguous.keyboard.press("Escape");
  // An old identity used only off-chain is selectable before any fields are entered.
  const offlineParent = { ...child, fullName: "Browser Acceptance Offline Father", gender: 1 };
  const offlineHash = await seedHelpers.computePersonHash({ personData: offlineParent });
  assert.equal(await deployed.deepFamily.childrenCount(offlineHash, 0), 0n);
  const offlineButton = ambiguous.getByRole("button", { name: /Father Information/ });
  await click(offlineButton);
  const offlineForm = offlineButton.locator("..");
  await selectProtocol(offlineForm, 1);
  await fillIdentity(offlineForm, offlineParent);
  await offlineForm.getByTitle(offlineHash, { exact: true }).waitFor();
  assert.equal(await protocolButton(offlineForm).textContent(), "Identity protocol 1");
  const currentMotherButton = ambiguous.getByRole("button", { name: /Mother Information/ });
  await click(currentMotherButton);
  const currentMother = currentMotherButton.locator("..");
  await choose(ambiguous, currentMother.getByRole("button", { name: "Female", exact: true }), "Unknown");
  await fillIdentity(currentMother, legacy);
  await currentMother.getByRole("button", { name: "Identity protocol 2 (older activity found)", exact: true }).waitFor();
  const currentMotherHash = await currentMother.getByText(/^0x[0-9a-f]{64}$/i).innerText();
  assert.notEqual(currentMotherHash, legacyHash);
  await addVersion(ambiguous, "two-existing-identities-add-version-to-selected-person-hash", family);
  assert.equal(await deployed.deepFamily.personVersionsCount(newUserSuite2Hash), 2n);
  assert.equal(await deployed.deepFamily.personVersionsCount(newUserSuite1Hash), 0n);
  const withOfflineParent = await deployed.deepFamily.personVersionAt(newUserSuite2Hash, 1);
  assert.equal(withOfflineParent.fatherHash, offlineHash);
  assert.equal(withOfflineParent.fatherVersionIndex, 0n);
  assert.equal(withOfflineParent.motherHash, currentMotherHash);
  assert.equal(withOfflineParent.motherVersionIndex, 0n);
  assert.equal((await deployed.deepFamily.personVersionAt(newUserSuite2Hash, 0)).motherHash, legacyHash);
  assert.equal(await deployed.deepFamily.personVersionsCount(offlineHash), 0n);
  assert.equal(await deployed.deepFamily.childrenCount(offlineHash, 0), 1n);

  const { page: mobile } = await openPage("mobile-protocol-menu", baseUrl + createPath, address, rpcUrl, reader, rootHash, "zh-CN");
  await mobile.setViewportSize({ width: 390, height: 844 });
  const mobileForm = mobile.getByRole("region", { name: "人物信息" });
  await fillIdentity(mobileForm, parentOnly);
  const labelRow = mobileForm.locator("label").filter({ hasText: /^身份口令$/ }).locator("..");
  await click(labelRow.getByRole("button", { name: "身份协议 2（有旧记录）", exact: true }));
  const mobileMenu = mobileForm.getByRole("listbox");
  await mobileMenu.getByRole("option", { name: /身份协议 2.*建立独立的人物档案/ }).waitFor();
  await mobileMenu.getByRole("option", { name: /身份协议 1.*添加到已有的人物档案/ }).waitFor();
  const bounds = await mobileMenu.boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, "The menu fits on a mobile screen");
  await capture(mobile, "identity-protocol-menu-zh-mobile");
  await mobile.keyboard.press("Escape");
  await mobileMenu.waitFor({ state: "hidden" });
  assert(await mobileForm.isVisible(), "Closing the protocol menu keeps the draft open");
  report.checks.push({ label: "mobile-chinese-protocol-menu", status: "passed" });

  await checkMintSuiteUpgrade({
    baseUrl, rpcUrl, baseline, address, reader, rootHash, child, deployed, signer,
    originalHash: registration.personHash, upgradedHash: otherHash,
  });
}

async function checkMintSuiteUpgrade({
  baseUrl, rpcUrl, baseline, address, reader, rootHash, child, deployed, signer, originalHash, upgradedHash,
}) {
  const family = deployed.deepFamily;
  const familyAddress = await family.getAddress();
  const mintPath = "/create?tab=mint-nft";
  const tokenIds = [];
  for (const [suite, personHash, versionIndex] of [[2, upgradedHash, 1], [1, originalHash, 2]]) {
    assert.equal(await family.versionToTokenId(personHash, versionIndex), 0n);
    if (await family.endorsedVersionIndex(personHash, address) !== BigInt(versionIndex)) {
      await seedHelpers.endorseVersion({ deepFamily: family, token: deployed.token, signer, personHash, versionIndex });
    }
    // The old record opens from its version link. The new one starts in the standalone mint form.
    const url = suite === 1 ? `${mintPath}&hash=${personHash}&vi=${versionIndex}` : `${mintPath}&open=1`;
    const label = `suite-2-client-mints-suite-${suite}-record-version-${versionIndex}`;
    const { page } = await openPage(label, baseUrl + url, address, rpcUrl, reader, rootHash);
    const dialog = page.getByRole("dialog", { name: "Mint NFT" });
    await fillIdentity(dialog, child);
    if (suite === 2) {
      await dialog.getByTitle(upgradedHash, { exact: true }).waitFor();
      await selectProtocol(dialog, 1);
      await dialog.getByTitle(originalHash, { exact: true }).waitFor();
      // An explicitly pasted target takes precedence over the previous local hash preview.
      await dialog.getByRole("textbox", { name: /Person Hash/i }).fill("0x" + personHash.slice(2).toUpperCase());
    }
    await dialog.getByText(`This record uses identity protocol ${suite}.`, { exact: false }).waitFor();
    assert.equal(await protocolButton(dialog).count(), 0);
    await dialog.getByTitle(personHash, { exact: true }).waitFor();
    for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
    const before = report.transactions.length;
    await click(dialog.getByRole("button", { name: "Mint NFT", exact: true }));
    await click(dialog.getByRole("button", { name: "Continue to Wallet", exact: true }));
    const receipt = await confirmed(page, label, before, familyAddress);
    await dialog.getByRole("button", { name: "Continue Minting", exact: true }).waitFor();

    const tx = await connection.ethers.provider.getTransaction(receipt.hash);
    const call = family.interface.parseTransaction({ data: tx.data });
    assert.equal(call.name, "mintPersonVersionNFT");
    assert.equal(call.args.versionIndex, BigInt(versionIndex));
    assert.equal(call.args.publicSignals.suiteCommitment, poseidon4([DOMAIN_SUITE, BigInt(suite), 0n, 0n]));
    assert.equal(wrapIdentityCommitmentAsPersonHash(call.args.publicSignals.identityCommitment), personHash);
    const tokenId = await family.versionToTokenId(personHash, versionIndex);
    assert(tokenId > 0n);
    assert.equal(await family.tokenIdToPerson(tokenId), personHash);
    assert.equal(await family.tokenIdToVersionIndex(tokenId), BigInt(versionIndex));
    assert.equal(await family.ownerOf(tokenId), address);
    tokenIds.push(tokenId);
  }
  assert.notEqual(tokenIds[0], tokenIds[1]);
  assert.equal(await family.versionToTokenId(originalHash, 1), 0n);
  assert.equal(await family.versionToTokenId(originalHash, 3), 0n);

  const before = report.transactions.length;
  const { page } = await openPage("suite-1-mint-client", baseline.baseUrl + mintPath + "&open=1", address, baseline.rpcUrl, reader, rootHash);
  const dialog = page.getByRole("dialog", { name: "Mint NFT" });
  await dialog.getByRole("textbox", { name: /Person Hash/i }).waitFor();
  assert.equal(await protocolButton(dialog).count(), 0);
  await dialog.getByRole("textbox", { name: /Person Hash/i }).fill(upgradedHash);
  await dialog.getByRole("alert").filter({ hasText: "does not support the identity protocol" }).waitFor();
  assert(await dialog.getByRole("button", { name: "Mint NFT", exact: true }).isDisabled());
  assert.equal(report.transactions.length, before);
  report.checks.push({ label: "suite-1-mint-client-recognizes-unsupported-suite-2-target", status: "passed" });
}

async function addVersion(page, label, family) {
  const dialog = page.getByRole("dialog");
  await dialog.locator('textarea[name="biography"]').fill(label);
  for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
  const before = report.transactions.length;
  await click(dialog.getByRole("button", { name: "Add Version", exact: true }));
  await click(dialog.getByRole("button", { name: "Continue to Wallet", exact: true }));
  await confirmed(page, label, before, family);
}
async function receiveCode(page) {
  await click(
    page.getByRole("button", {
      name: "Identity-credential budget receiving credential",
      exact: true,
    }),
  );
  const input = page.getByRole("textbox", { name: "Budget receiving credential", exact: true });
  await until(
    () => input.inputValue(),
    (value) => value.length > 100,
    "receive credential proved",
  );
  const code = await input.inputValue();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  return code;
}
async function confirmed(page, label, countBefore, target) {
  const transaction = await until(
    async () => {
      const failure = (await page.getByRole("alert").allTextContents()).find((text) =>
        /failed|could not|unavailable|expired|insufficient/i.test(text),
      );
      if (failure) throw new Error(`${label}: ${failure}`);
      return report.transactions
        .slice(countBefore)
        .find((tx) => !target || tx.to?.toLowerCase() === target.toLowerCase());
    },
    Boolean,
    label,
    1_200_000,
  );
  const receipt = await until(
    () => connection.ethers.provider.getTransactionReceipt(transaction.hash),
    Boolean,
    "receipt",
  );
  assert.equal(receipt.status, 1, label);
  report.checks.push({
    label,
    transactionHash: transaction.hash,
    blockNumber: receipt.blockNumber,
    status: "passed",
  });
  await capture(page, label);
  console.log(`[browser-acceptance] Confirmed ${label}`);
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  return receipt;
}

try {
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  // A fresh EDR network has no external RPC, signer key or reusable deployment.
  process.chdir(root);
  const { default: hre } = await import("hardhat");
  connection = await hre.network.create({
    network: "default",
    override: { allowBlocksWithSameTimestamp: true, mining: { auto: true, interval: 0 } },
  });
  assert.equal(await connection.provider.request({ method: "eth_chainId" }), "0x7a69");
  const [signer, other] = await connection.ethers.getSigners();
  const address = await signer.getAddress();
  console.log("[browser-acceptance] Deploying isolated local contracts");
  const deployed = await deployIntegratedSystem(connection, {
    artifacts: hre.artifacts,
    signer,
    governanceOwner: address,
    governanceMultisig: null,
  });
  const common = {
    gender: 0,
    isBirthBC: false,
    birthMonth: 1,
    birthDay: 1,
    passphrase: "Synthetic browser acceptance identity 2026!",
  };
  const parent = { ...common, fullName: "Browser Acceptance Parent", birthYear: 1960 };
  const child = { ...common, fullName: "Browser Acceptance Child", birthYear: 1990 };
  const parentResult = await seedHelpers.addPersonVersion({
    deepFamily: deployed.deepFamily,
    signer,
    personData: parent,
  });
  const childResult = await seedHelpers.addPersonVersion({
    deepFamily: deployed.deepFamily,
    signer,
    personData: child,
    fatherData: parent,
    fatherVersion: 1,
  });
  await seedHelpers.endorseVersion({
    deepFamily: deployed.deepFamily,
    token: deployed.token,
    signer,
    personHash: childResult.personHash,
    versionIndex: 1,
  });
  const reader = await deployed.deepFamilyReader.getAddress();
  const pool = deployed.shieldedNativePool;
  const poolAddress = await pool.getAddress();
  const env = {
    ...process.env,
    VITE_READER_ADDRESS: reader,
    VITE_READER_ADDRESS_31337: reader,
    VITE_ROOT_PERSON_HASH: parentResult.personHash,
    VITE_ROOT_PERSON_HASH_EN: parentResult.personHash,
    VITE_ZK_ASSET_BASE_URL: "",
    VITE_SHIELDED_STATE_READ_MODE: "rebuild",
    VITE_SHIELDED_POOL_FACTORY_ADDRESS_31337: await deployed.shieldedPoolFactory.getAddress(),
    VITE_SHIELDED_POOL_FACTORY_FROM_BLOCK_31337: "0",
    VITE_PRIVATE_LETTER_ARCHIVE_ADDRESS_31337: await deployed.privateLetterArchive.getAddress(),
    VITE_PRIVATE_LETTER_ARCHIVE_FROM_BLOCK_31337: "0",
  };
  console.log("[browser-acceptance] Building production browser bundle");
  const { baseUrl, rpcUrl } = await serveFrontend(env, dist);
  browser = await chromium.launch(
    process.env.BROWSER_ACCEPTANCE_EXECUTABLE_PATH
      ? { executablePath: process.env.BROWSER_ACCEPTANCE_EXECUTABLE_PATH }
      : { channel: process.env.BROWSER_ACCEPTANCE_CHROME_CHANNEL ?? "chrome" },
  );

  console.log("[browser-acceptance] Adding a version through the real UI");
  const created = {
    ...common,
    fullName: "Browser Acceptance Added Person",
    birthYear: 1980,
    passphrase: "",
  };
  const addedHash = await seedHelpers.computePersonHash({ personData: created });
  const { page: createPage } = await openPage(
    "create",
    `${baseUrl}/create?tab=add-version&open=1`,
    address,
    rpcUrl,
    reader,
    parentResult.personHash,
  );
  const dialog = createPage.getByRole("dialog");
  assert.equal(await dialog.getByText(/^Identity protocol \d/).count(), 0, "The suite-1 form has no protocol selectors");
  await fillIdentity(dialog.getByRole("region", { name: "Person Information" }), created);
  await dialog
    .locator('textarea[name="biography"]')
    .fill("Synthetic browser acceptance biography.");
  for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
  let before = report.transactions.length;
  await click(dialog.getByRole("button", { name: "Add Version", exact: true }));
  await click(dialog.getByRole("button", { name: "Continue to Wallet", exact: true }));
  await confirmed(createPage, "add-version", before, await deployed.deepFamily.getAddress());
  await createPage
    .getByRole("heading", { name: "Version Added Successfully", exact: true })
    .waitFor();
  assert.equal(await deployed.deepFamily.personVersionsCount(addedHash), 1n);
  await verifyLateVersionReceipt(createPage, deployed.deepFamily, created);
  await createPage.evaluate((hash) => {
    const config = JSON.parse(localStorage.getItem("ft:config"));
    localStorage.setItem(
      "ft:config",
      JSON.stringify({ ...config, rootHash: hash, rootVersionIndex: 1 }),
    );
  }, addedHash);
  await createPage.goto(`${baseUrl}/people?person=${addedHash}`, { waitUntil: "domcontentloaded" });
  await createPage.reload({ waitUntil: "domcontentloaded" });
  await createPage.getByText(created.fullName, { exact: true }).first().waitFor();
  await capture(createPage, "version-after-reload");
  report.checks.push({
    label: "version-visible-after-reload",
    status: "passed",
    personHash: addedHash,
  });

  console.log("[browser-acceptance] Depositing, funding and claiming with real browser proofs");
  const parentPage = (
    await openPage(
      "parent",
      `${baseUrl}/inheritance`,
      address,
      rpcUrl,
      reader,
      parentResult.personHash,
    )
  ).page;
  const childTab = await openPage(
    "child",
    `${baseUrl}/inheritance`,
    address,
    rpcUrl,
    reader,
    parentResult.personHash,
  );
  await unlock(parentPage, parent);
  await unlock(childTab.page, child);
  await task(parentPage, "Deposit").click();
  await parentPage.getByRole("textbox", { name: "Amount (ETH)", exact: true }).fill("0.02");
  before = report.transactions.length;
  await click(parentPage.getByRole("button", { name: "Confirm Deposit", exact: true }));
  await confirmed(parentPage, "deposit", before, poolAddress);
  await idle(parentPage);
  const budgetCode = await receiveCode(childTab.page);
  await task(parentPage, "Fund").click();
  await parentPage
    .getByRole("textbox", { name: "Period allowance (ETH)", exact: true })
    .fill("0.003");
  await parentPage.getByRole("textbox", { name: "Periods to fund", exact: true }).fill("3");
  await choose(
    parentPage,
    parentPage.getByRole("button", { name: /^Claim interval / }),
    "Every 1 days",
  );
  const version = parentPage.getByRole("button", { name: /^Parent person version / });
  if (await version.count()) await choose(parentPage, version, "Version 1");
  await parentPage.getByRole("radio", { name: /Child 1/ }).check();
  await parentPage
    .getByRole("radio", { name: "Private (identity credentials)", exact: true })
    .check();
  await parentPage
    .getByRole("textbox", { name: "Recipient budget receiving credential", exact: true })
    .fill(budgetCode);
  before = report.transactions.length;
  await click(parentPage.getByRole("button", { name: "Confirm Fund", exact: true }));
  const funded = await confirmed(parentPage, "fund", before, poolAddress);
  const block = await connection.ethers.provider.getBlock(funded.blockNumber);
  await connection.provider.request({
    method: "evm_setNextBlockTimestamp",
    params: [block.timestamp + 7200 + 86400 + 10],
  });
  await connection.provider.request({ method: "evm_mine" });
  await refresh(childTab.page);
  await task(childTab.page, "Claim").click();
  const nullifiersBefore = await pool.nullifierCount();
  before = report.transactions.length;
  await click(childTab.page.getByRole("button", { name: "Confirm Claim", exact: true }));
  const claimed = await confirmed(childTab.page, "claim", before, poolAddress);
  await idle(childTab.page);
  const nullifiersAfter = await pool.nullifierCount();
  assert(nullifiersAfter > nullifiersBefore);
  assert.equal(await connection.ethers.provider.getBalance(poolAddress), 20_000_000_000_000_000n);
  const original = await connection.ethers.provider.getTransaction(claimed.hash);
  const claimCall = pool.interface.parseTransaction({ data: original.data });
  assert.equal(claimCall.name, "claim");
  await assert.rejects(
    () =>
      connection.ethers.provider.call({
        from: original.from,
        to: original.to,
        data: original.data,
      }),
    (error) => error.data === pool.interface.encodeErrorResult("NullifierAlreadySpent"),
  );
  assert.equal(await pool.nullifierCount(), nullifiersAfter);
  assert.equal(await connection.ethers.provider.getBalance(poolAddress), 20_000_000_000_000_000n);
  report.checks.push({
    label: "claim-replay-rejected-without-state-change",
    status: "passed",
    nullifiersBefore: String(nullifiersBefore),
    nullifiersAfter: String(nullifiersAfter),
  });
  await refresh(childTab.page);
  await checkClaimedBalances(childTab.page);
  report.checks.push({
    label: "claimed-balances-after-refresh",
    status: "passed",
    available: "0.003",
    budget: "0.006",
    symbol: "ETH",
  });
  await capture(childTab.page, "claimed-balances-after-refresh");

  console.log("[browser-acceptance] Changing wallet context while a request is pending");
  for (const change of [{ account: await other.getAddress() }, { chainId: "0x1" }]) {
    await task(childTab.page, "Deposit").click();
    await childTab.page.getByRole("textbox", { name: "Amount (ETH)", exact: true }).fill("0.001");
    childTab.bridge.holdNext = true;
    before = report.transactions.length;
    await click(childTab.page.getByRole("button", { name: "Confirm Deposit", exact: true }));
    await until(() => childTab.bridge.pending, Boolean, "wallet request waiting", 1_200_000);
    Object.assign(childTab.bridge, change);
    await childTab.page.evaluate((change) => window.__acceptanceWalletChange(change), change);
    childTab.bridge.pending();
    await until(() => childTab.bridge.pending === null, Boolean, "old wallet request settled");
    await until(
      () =>
        change.chainId
          ? childTab.page.getByRole("button", { name: "Switch network", exact: true }).isVisible()
          : childTab.page.getByRole("textbox", { name: "Amount (ETH)", exact: true }).isVisible(),
      Boolean,
      "new wallet scope visible",
    );
    if (change.chainId)
      assert.equal(
        await childTab.page.getByRole("textbox", { name: "Amount (ETH)", exact: true }).count(),
        0,
      );
    assert.equal(
      report.transactions.length,
      before,
      "A cancelled wallet request must not broadcast",
    );
    assert.equal(await connection.ethers.provider.getBalance(poolAddress), 20_000_000_000_000_000n);
    report.checks.push({
      label: change.account ? "pending-account-switch" : "pending-network-switch",
      status: "passed",
    });
    await capture(
      childTab.page,
      change.account ? "pending-account-switch" : "pending-network-switch",
    );
    console.log(
      `[browser-acceptance] Verified pending ${change.account ? "account" : "network"} switch`,
    );
  }
  console.log("[browser-acceptance] Unlocking an existing suite-1 wallet after upgrading the default to suite 2");
  await checkIdentitySuiteUpgrade({
    env, baseline: { baseUrl, rpcUrl }, address, reader, rootHash: parentResult.personHash, child, registration: childResult, deployed, signer,
  });
  report.status = "passed";
  console.log(`[browser-acceptance] Passed ${report.checks.length} checks`);
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  for (const { label, page } of pages) {
    await capture(page, `${label}-failure`).catch(() => {});
    await fs
      .writeFile(path.join(output, `${label}-failure.txt`), await page.locator("body").innerText())
      .catch(() => {});
  }
  console.error(`[browser-acceptance] ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const { label, context } of pages) {
    await context.tracing.stop({ path: path.join(output, `${label}-trace.zip`) }).catch(() => {});
    await context.close().catch(() => {});
  }
  await browser?.close();
  for (const server of servers) server.kill("SIGTERM");
  await connection?.close();
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
