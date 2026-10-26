#!/usr/bin/env node
// Resume only the actual Source/Q publication boundaries after a browser closes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Interface, JsonRpcProvider } from "ethers";
import { chromium } from "playwright-core";
import { assertLocalAcceptanceRpc } from "../../test/helpers/qualification-browser-fixture.mjs";
import { installQualificationBrowserWallet } from "./lib/qualification-browser-wallet.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const labels = JSON.parse(
  await fs.readFile(path.join(ROOT, "frontend/src/locales/en/index.json"), "utf8"),
);
const w = (key) => labels.walletProtocol[key],
  q = (key) => labels.qualificationManager[key];
const password = (role) => `Browser acceptance ${role} backup password`;
async function latestBackup(directory, role) {
  const files = (await fs.readdir(directory)).filter(
    (name) => name.startsWith(`${role}-`) && name.endsWith(".dfwallet"),
  );
  const entries = await Promise.all(
    files.map(async (name) => ({ name, stat: await fs.stat(path.join(directory, name)) })),
  );
  entries.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  assert.ok(entries.length, `Missing ${role} backup`);
  return path.join(directory, entries[0].name);
}
/** The unlocked overview's asset menu lists DEEP first and the network's native asset second. */
async function selectNativeAsset(page) {
  const overview = page.getByRole("region", { name: labels.shielded.balanceTitle, exact: true });
  const menu = new RegExp(`^${labels.shielded.assets.label} `, "u");
  await overview.getByRole("button", { name: menu }).click();
  const native = page.getByRole("option").nth(1);
  const symbol = (await native.textContent()).trim();
  await native.click();
  await page
    .getByRole("region", { name: labels.shielded.balanceTitle, exact: true })
    .getByRole("button", { name: `${labels.shielded.assets.label} ${symbol}`, exact: true })
    .waitFor();
}

export async function runQualificationRecoveryAcceptance({
  fixtureFile = process.env.QUALIFICATION_ACCEPTANCE_FIXTURE,
  baseUrl = process.env.QUALIFICATION_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:5173",
} = {}) {
  assert.ok(
    fixtureFile,
    "Set QUALIFICATION_ACCEPTANCE_FIXTURE to the completed main flow's private fixture",
  );
  const fixture = JSON.parse(await fs.readFile(path.resolve(fixtureFile), "utf8"));
  const parent = path.dirname(path.resolve(fixtureFile)),
    directory = path.join(parent, "recovery");
  assert.ok(parent.startsWith(path.join(ROOT, "tmp") + path.sep));
  const url = new URL(baseUrl);
  assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const provider = new JsonRpcProvider(assertLocalAcceptanceRpc(fixture.rpcUrl), undefined, {
    cacheTimeout: -1,
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const report = {
    developmentOnly: true,
    completed: false,
    realProofsAndContracts: true,
    startedAt: new Date().toISOString(),
    steps: [],
    transactions: [],
    interruptions: [],
    errors: [],
  };
  const pages = {},
    downloads = new Map(),
    jobs = new WeakMap();
  let serial = 0,
    interruptNext = null;
  try {
    assert.equal(String((await provider.getNetwork()).chainId), fixture.chainId);
    const interfaces = {};
    for (const name of ["EligibilitySource", "ReceiveRegistry"]) {
      const artifact = JSON.parse(
        await fs.readFile(path.join(ROOT, "deployments/localhost", `${name}.json`), "utf8"),
      );
      assert.equal(artifact.address.toLowerCase(), fixture.deployments[name].toLowerCase());
      interfaces[artifact.address.toLowerCase()] = new Interface(artifact.abi);
    }
    const step = async (name, operation) => {
      console.log(`[qualification-recovery] ${name}`);
      const started = Date.now();
      const detail = await operation();
      report.steps.push({ name, elapsedMs: Date.now() - started, ...(detail ? { detail } : {}) });
      await fs.writeFile(
        path.join(directory, "report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      return detail;
    };
    const open = async (role, backup) => {
      const context = await browser.newContext({
        acceptDownloads: true,
        locale: "en-US",
        viewport: { width: 1280, height: 900 },
      });
      await installQualificationBrowserWallet(context, {
        provider,
        address: fixture.actors[role].address,
        chainId: fixture.chainId,
        transactions: report.transactions,
        afterTransaction: async ({ hash, transaction }) => {
          const expected = interruptNext;
          if (!expected || expected.role !== role) return;
          const iface = interfaces[transaction.to?.toLowerCase()],
            decoded = iface?.parseTransaction({ data: transaction.data });
          if (decoded?.name !== expected.method) return;
          const receipt = await provider.getTransactionReceipt(hash);
          assert.equal(receipt.status, 1);
          const event = receipt.logs
            .map((log) => {
              try {
                return iface.parseLog(log);
              } catch {
                return null;
              }
            })
            .find((log) => log?.name === expected.event);
          assert.ok(event, "Interrupt only after the real chain event confirms publication");
          interruptNext = null;
          await Promise.all(downloads.get(role).map((item) => item.promise));
          const saved = downloads
            .get(role)
            .filter((item) => item.filename.endsWith(".dfwallet"))
            .at(-1)?.file;
          assert.ok(saved, "A draft backup must finish downloading before actual publication");
          report.interruptions.push({
            role,
            method: decoded.name,
            event: event.name,
            transactionHash: hash,
            blockNumber: receipt.blockNumber,
            browserClosedBeforeWorkerConfirmation: true,
            backup: path.relative(parent, saved),
          });
          await context.close();
          delete pages[role];
          expected.resolve(saved);
        },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(180_000);
      page.on("pageerror", (error) => report.errors.push({ role, message: error.message }));
      downloads.set(role, []);
      page.on("download", (download) => {
        const filename = download.suggestedFilename(),
          file = path.join(directory, `${role}-${++serial}-${filename}`);
        const promise = download.saveAs(file).then(() => file);
        downloads.get(role).push({ filename, file, promise });
        jobs.set(download, promise);
      });
      pages[role] = { context, page };
      await page.goto(new URL("/inheritance", url).toString(), { waitUntil: "networkidle" });
      await page.getByLabel(w("backupFile"), { exact: true }).setInputFiles(backup);
      await page.getByLabel(w("backupPassword"), { exact: true }).fill(password(role));
      await page.getByRole("button", { name: w("restore"), exact: true }).click();
      await page.getByText(w("restored"), { exact: true }).waitFor();
      await selectNativeAsset(page);
      return page;
    };
    const panel = async (role, tab) => {
      const page = pages[role].page;
      await page
        .getByRole("navigation", { name: labels.shielded.actionsTitle, exact: true })
        .getByRole("button", { name: q("title"), exact: true })
        .click();
      const manager = page.getByTestId("qualification-manager");
      await manager
        .getByRole("navigation", { name: q("actions"), exact: true })
        .getByRole("button", { name: q(tab), exact: true })
        .click();
      return manager;
    };
    const enterPassword = (role, manager) =>
      manager.getByLabel(q("backupPassword"), { exact: true }).fill(password(role));
    const download = async (role, suffix, action) => {
      const page = pages[role].page,
        future = page.waitForEvent("download", {
          predicate: (item) => item.suggestedFilename().endsWith(suffix),
        });
      await action();
      const item = await Promise.race([
        future,
        page
          .locator('[role="alert"]')
          .last()
          .waitFor()
          .then(async () => {
            throw new Error(await page.locator('[role="alert"]').last().textContent());
          }),
      ]);
      return jobs.get(item);
    };
    const interruptedAction = async (role, method, event, action) => {
      let resolve;
      const signal = new Promise((done) => {
        resolve = done;
      });
      interruptNext = { role, method, event, resolve };
      await action().catch((error) => {
        if (!String(error.message).includes("closed")) throw error;
      });
      const timeout = new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Expected publication interruption did not occur")),
          180_000,
        );
        timer.unref();
      });
      return Promise.race([signal, timeout]);
    };
    await step(
      "restore issuer and recipient independently from completed encrypted backups",
      async () => {
        await open("issuer", await latestBackup(parent, "issuer"));
        await open("recipient", await latestBackup(parent, "recipient"));
      },
    );
    const request = await step(
      "create fresh same-family request for interruption recovery",
      async () => {
        const manager = await panel("recipient", "request");
        await manager
          .getByLabel(q("parentHash"), { exact: true })
          .fill(fixture.persons.parent.personHash);
        await manager.getByLabel(q("parentVersion"), { exact: true }).fill("1");
        await manager
          .getByLabel(q("endorser"), { exact: true })
          .fill(fixture.actors.issuer.address);
        await enterPassword("recipient", manager);
        await download("recipient", ".dfwallet", () =>
          manager.getByRole("button", { name: q("createRequest"), exact: true }).click(),
        );
        return manager.getByLabel(q("requestText"), { exact: true }).inputValue();
      },
    );
    // Public request text is passed only between the actual two UI windows.
    report.steps.at(-1).detail = undefined;
    const factBackup = await step(
      "close issuer browser immediately after real fact publication event",
      async () => {
        const manager = await panel("issuer", "source");
        await manager.getByLabel(q("incomingRequest"), { exact: true }).fill(request);
        await manager.getByLabel(q("sourceKind"), { exact: true }).selectOption("fact");
        await enterPassword("issuer", manager);
        return interruptedAction("issuer", "publishFact", "SourceLeafPublished", () =>
          manager.getByRole("button", { name: q("publish"), exact: true }).click(),
        );
      },
    );
    const factPackage = await step(
      "restore controller draft and recover confirmed fact without transaction hash",
      async () => {
        await open("issuer", factBackup);
        const manager = await panel("issuer", "roles");
        const select = manager.getByLabel(q("savedSource"), { exact: true });
        const options = await select.locator("option").allTextContents();
        const index = options.findLastIndex(
          (value) => value.includes(q("fact")) && value.includes(q("draft")),
        );
        assert.ok(index > 0);
        await select.selectOption({ index });
        assert.equal(
          await manager.getByLabel(q("sourceTransaction"), { exact: true }).inputValue(),
          "",
        );
        await enterPassword("issuer", manager);
        const file = await download("issuer", ".dfqualification", () =>
          manager.getByRole("button", { name: q("confirmPublication"), exact: true }).click(),
        );
        await manager.getByText(q("sourceConfirmed"), { exact: true }).waitFor();
        return file;
      },
    );
    const trustPackage = await step("publish complementary real trust approval", async () => {
      const manager = await panel("issuer", "source");
      await manager.getByLabel(q("incomingRequest"), { exact: true }).fill(request);
      await manager.getByLabel(q("sourceKind"), { exact: true }).selectOption("trust");
      await enterPassword("issuer", manager);
      return download("issuer", ".dfqualification", () =>
        manager.getByRole("button", { name: q("publish"), exact: true }).click(),
      );
    });
    await step("import exact recovered encrypted approvals", async () => {
      const manager = await panel("recipient", "request");
      for (const file of [factPackage, trustPackage]) {
        await enterPassword("recipient", manager);
        await download("recipient", ".dfwallet", () =>
          manager.getByLabel(q("packageFile"), { exact: true }).setInputFiles(file),
        );
        await manager.getByText(q("packageImported"), { exact: true }).waitFor();
      }
    });
    const issueBackup = await step(
      "close recipient browser after real credential registration event",
      async () => {
        const manager = pages.recipient.page.getByTestId("qualification-manager");
        await enterPassword("recipient", manager);
        return interruptedAction("recipient", "registerCredential", "CredentialIssued", () =>
          manager
            .getByTestId("qualification-issue")
            .getByRole("button", { name: q("issue"), exact: true })
            .click(),
        );
      },
    );
    await step(
      "restore prepared issuance and install exact on-chain Q without transaction hash",
      async () => {
        await open("recipient", issueBackup);
        const manager = await panel("recipient", "request");
        await manager.getByText(q("resumeRegistration"), { exact: true }).click();
        assert.equal(
          await manager.getByLabel(q("issueTransaction"), { exact: true }).inputValue(),
          "",
        );
        await enterPassword("recipient", manager);
        await download("recipient", ".dfwallet", () =>
          manager.getByRole("button", { name: q("confirmRegistration"), exact: true }).click(),
        );
        await manager
          .getByTestId("qualification-issue")
          .getByText(q("qualificationIssued"), { exact: true })
          .waitFor();
      },
    );
    await step("capture qualification request and role layouts on desktop and mobile", async () => {
      for (const [role, tab] of [
        ["recipient", "request"],
        ["issuer", "roles"],
      ]) {
        const page = pages[role].page;
        await panel(role, tab);
        for (const [name, width, height] of [
          ["desktop", 1280, 900],
          ["mobile", 390, 844],
        ]) {
          await page.setViewportSize({ width, height });
          await page.screenshot({
            path: path.join(directory, `${role}-${tab}-${name}.png`),
            fullPage: true,
          });
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            "Qualification form must not overflow horizontally",
          );
        }
      }
    });
    for (const tx of report.transactions) {
      const receipt = await provider.getTransactionReceipt(tx.transactionHash);
      assert.equal(receipt.status, 1);
      tx.blockNumber = receipt.blockNumber;
      tx.gasUsed = String(receipt.gasUsed);
    }
    assert.equal(report.interruptions.length, 2);
    assert.equal(report.transactions.length, 3);
    assert.equal(report.errors.length, 0);
    report.completed = true;
    console.log(
      `[qualification-recovery] Completed ${report.steps.length} DOM stages and two confirmed-transaction interruptions`,
    );
  } catch (error) {
    report.failure = error.message;
    for (const [role, { page }] of Object.entries(pages))
      await page
        .screenshot({ path: path.join(directory, `${role}-failure.png`), fullPage: true })
        .catch(() => {});
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await browser.close();
    provider.destroy();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runQualificationRecoveryAcceptance();
  } catch (error) {
    console.error(`[qualification-recovery] ${error.message}`);
    process.exitCode = 1;
  }
}
