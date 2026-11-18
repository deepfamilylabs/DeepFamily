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
let browser, server, connection;

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

async function openPage(label, url, address, rpcUrl, reader, rootHash) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    locale: "en-US",
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
    ({ rpcUrl, reader, rootHash }) => {
      localStorage.setItem("i18nextLng", "en");
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
    { rpcUrl, reader, rootHash },
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const connect = page.getByRole("button", { name: "Connect Wallet", exact: true }).first();
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
  await fillIdentity(dialog, retired);
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
    await fillIdentity(dialog, next);
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
async function unlock(page, identity) {
  await page.locator('input[name="fullName"]').waitFor();
  await fillIdentity(page, identity);
  await click(page.getByRole("button", { name: "Unlock identity", exact: true }));
  await task(page, "Deposit").waitFor();
  await idle(page);
  await choose(page, page.getByRole("button", { name: /^Asset DEEP$/ }), "ETH");
  await idle(page);
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
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const rpcUrl = `${baseUrl}/__browser-acceptance/rpc`;
  const env = {
    ...process.env,
    VITE_RPC_URL: rpcUrl,
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
  const build = startVite(["build", "--outDir", dist, "--emptyOutDir"], env);
  assert.equal(
    await new Promise((resolve, reject) => {
      build.once("error", reject);
      build.once("exit", resolve);
    }),
    0,
    "Browser acceptance build failed; see vite.log",
  );
  server = startVite(
    ["preview", "--outDir", dist, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    env,
  );
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
  await fillIdentity(dialog, created);
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
  await until(
    async () =>
      (
        await childTab.page
          .getByRole("group", { name: "Identity credentials", exact: true })
          .locator("dd")
          .allTextContents()
      ).map((value) => value.replace(/\s/g, "")),
    (values) => values[0] === "0.003ETH" && values[1] === "0.006ETH",
    "claimed VALUE and remaining budget balances",
  );
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
  server?.kill("SIGTERM");
  await connection?.close();
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
