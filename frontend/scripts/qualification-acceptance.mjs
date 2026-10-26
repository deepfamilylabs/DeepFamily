#!/usr/bin/env node
// Actual localhost contracts, browser DOM and production wallet workers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, getAddress, ZeroAddress } from "ethers";
import { chromium } from "playwright-core";
import {
  prepareQualificationBrowserFixture,
  assertLocalAcceptanceRpc,
} from "../../test/helpers/qualification-browser-fixture.mjs";
import { installQualificationBrowserWallet } from "./lib/qualification-browser-wallet.mjs";
import { verifyQualificationTransactionEvidence } from "./lib/qualification-browser-evidence.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const labels = JSON.parse(
  await fs.readFile(path.join(ROOT, "frontend/src/locales/en/index.json"), "utf8"),
);
const t = (key) => key.split(".").reduce((value, part) => value?.[part], labels);
const walletLabel = (key) => t(`walletProtocol.${key}`);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const qLabel = (key) => t(`qualificationManager.${key}`);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
function field(scope, name, { prefix = false } = {}) {
  return scope
    .locator("label")
    .filter({ hasText: new RegExp(`^${escapeRegex(name)}${prefix ? "" : "$"}`, "u") })
    .locator("..")
    .locator("input,textarea,select")
    .first();
}

function assertLocalPage(value) {
  const url = new URL(value);
  assert.ok(
    url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname),
    "Acceptance page must be a local HTTP server",
  );
  return url;
}

export async function runQualificationAcceptance({
  baseUrl = process.env.QUALIFICATION_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:5173",
  rpcUrl = process.env.QUALIFICATION_ACCEPTANCE_RPC ?? "http://127.0.0.1:8545",
  fixtureFile = process.env.QUALIFICATION_ACCEPTANCE_FIXTURE,
} = {}) {
  const pageUrl = assertLocalPage(baseUrl),
    localRpc = assertLocalAcceptanceRpc(rpcUrl);
  const prepared = fixtureFile
    ? null
    : await prepareQualificationBrowserFixture({ rpcUrl: localRpc });
  const fixture =
    prepared?.fixture ?? JSON.parse(await fs.readFile(path.resolve(fixtureFile), "utf8"));
  const directory = prepared?.directory ?? path.dirname(path.resolve(fixtureFile));
  assert.ok(
    directory.startsWith(path.join(ROOT, "tmp") + path.sep),
    "Acceptance evidence must stay beneath tmp/",
  );
  const provider = new JsonRpcProvider(localRpc, undefined, { cacheTimeout: -1 });
  const report = {
    schemaVersion: 1,
    developmentOnly: true,
    fixtureRunId: fixture.runId,
    realIdentityProofs: true,
    realWalletWorkers: true,
    realContracts: true,
    completed: false,
    startedAt: new Date().toISOString(),
    steps: [],
    transactions: [],
    errors: [],
    limitations: [],
  };
  const browser = await chromium.launch({
    headless: process.env.QUALIFICATION_ACCEPTANCE_HEADLESS !== "0",
    ...(process.env.QUALIFICATION_ACCEPTANCE_CHROME
      ? { executablePath: process.env.QUALIFICATION_ACCEPTANCE_CHROME }
      : { channel: "chrome" }),
  });
  const pages = {};
  const downloads = new Map();
  const downloadJobs = new WeakMap();
  let downloadSequence = 0;
  try {
    const network = await provider.getNetwork();
    assert.equal(String(network.chainId), fixture.chainId);
    for (const [name, address] of Object.entries(fixture.deployments)) {
      const deployed = JSON.parse(
        await fs.readFile(path.join(ROOT, "deployments/localhost", `${name}.json`), "utf8"),
      );
      assert.equal(
        getAddress(deployed.address),
        getAddress(address),
        "Fixture belongs to a stale deployment",
      );
      assert.notEqual(await provider.getCode(address), "0x");
    }
    const step = async (name, operation) => {
      const started = Date.now();
      console.log(`[qualification-acceptance] ${name}`);
      const detail = await operation();
      const publicDetail =
        typeof detail === "string" && detail.startsWith("df") ? { sha256: digest(detail) } : detail;
      report.steps.push({
        name,
        status: "passed",
        elapsedMs: Date.now() - started,
        ...(publicDetail ? { detail: publicDetail } : {}),
      });
      await fs.writeFile(
        path.join(directory, "report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      return detail;
    };
    const open = async (role) => {
      const context = await browser.newContext({ acceptDownloads: true, locale: "en-US" });
      await installQualificationBrowserWallet(context, {
        provider,
        address: fixture.actors[role].address,
        chainId: fixture.chainId,
        transactions: report.transactions,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(300_000);
      page.on("pageerror", (error) => report.errors.push({ role, message: error.message }));
      downloads.set(role, []);
      page.on("download", async (download) => {
        const file = path.join(
          directory,
          `${role}-${++downloadSequence}-${download.suggestedFilename()}`,
        );
        const job = download.saveAs(file).then(() => {
          downloads.get(role).push({ file, suggestedFilename: download.suggestedFilename() });
          return file;
        });
        downloadJobs.set(download, job);
      });
      await page.goto(new URL("/inheritance", pageUrl).toString(), { waitUntil: "networkidle" });
      await page.getByRole("button", { name: walletLabel("create"), exact: true }).waitFor();
      pages[role] = { page, context };
      await field(page, walletLabel("asset")).selectOption(ZeroAddress);
      await page
        .getByRole("button", { name: walletLabel("create"), exact: true })
        .waitFor({ state: "visible" });
      return page;
    };
    const waitForDownload = async (role, action, suffix) => {
      const page = pages[role].page;
      const awaited = page.waitForEvent("download", {
        predicate: (download) => !suffix || download.suggestedFilename().endsWith(suffix),
      });
      await action();
      const download = await Promise.race([
        awaited,
        page
          .locator('[role="alert"]')
          .last()
          .waitFor()
          .then(async () => {
            throw new Error(
              `Download action rejected: ${await page.locator('[role="alert"]').last().textContent()}`,
            );
          }),
      ]);
      return downloadJobs.get(download);
    };
    const password = (role) => `Browser acceptance ${role} backup password`;
    const enterPassword = async (role) =>
      pages[role].page
        .getByLabel(walletLabel("backupPassword"), { exact: true })
        .fill(password(role));
    const createWallet = async (role, person) => {
      const page = await open(role);
      if (person) {
        await page.getByLabel(walletLabel("walletKind"), { exact: true }).selectOption("family");
        await page.locator('input[name="fullName"]').fill(person.identityFields.fullName);
        for (const field of ["birthYear", "birthMonth", "birthDay"])
          await page.locator(`input[name="${field}"]`).fill(String(person.identityFields[field]));
        await page
          .getByPlaceholder(t("search.hashCalculator.passphrasePlaceholder"), { exact: true })
          .fill(person.identityPassphrase);
        await page
          .getByPlaceholder(t("search.hashCalculator.confirmPassphrasePlaceholder"), {
            exact: true,
          })
          .fill(person.identityPassphrase);
      }
      await enterPassword(role);
      await waitForDownload(
        role,
        () => page.getByRole("button", { name: walletLabel("create"), exact: true }).click(),
        ".dfwallet",
      );
      await page.getByRole("button", { name: walletLabel("lock"), exact: true }).waitFor();
      return { account: fixture.actors[role].address };
    };
    await step("create issuer wallet through page", () => createWallet("issuer"));
    await step("create identity-bound recipient wallet through page", () =>
      createWallet("recipient", fixture.persons.recipient),
    );
    await step("create independent payer wallet through page", () => createWallet("payer"));
    const task = async (role, name) => {
      const page = pages[role].page;
      await page
        .getByRole("navigation", { name: walletLabel("tasks"), exact: true })
        .getByRole("button", {
          name: name === "qualifications" ? qLabel("title") : walletLabel(name),
          exact: true,
        })
        .click();
      return page;
    };
    const management = async (role, tab) => {
      const page = await task(role, "qualifications");
      const panel = page.getByTestId("qualification-manager");
      await panel.waitFor();
      await panel
        .getByRole("navigation", { name: qLabel("actions"), exact: true })
        .getByRole("button", { name: qLabel(tab), exact: true })
        .click();
      return panel;
    };
    const managePassword = async (role, panel) =>
      panel.getByLabel(qLabel("backupPassword"), { exact: true }).fill(password(role));
    const latestBackup = async (role) => {
      const entries = downloads
        .get(role)
        .filter((item) => item.suggestedFilename.endsWith(".dfwallet"));
      assert.ok(entries.length, `${role} must have a downloaded backup`);
      return entries.at(-1).file;
    };
    const createRequest = async () => {
      const panel = await management("recipient", "request");
      await panel
        .getByLabel(qLabel("parentHash"), { exact: true })
        .fill(fixture.persons.parent.personHash);
      await panel.getByLabel(qLabel("parentVersion"), { exact: true }).fill("1");
      await panel
        .getByLabel(qLabel("endorser"), { exact: true })
        .fill(fixture.actors.issuer.address);
      await managePassword("recipient", panel);
      await waitForDownload(
        "recipient",
        () => panel.getByRole("button", { name: qLabel("createRequest"), exact: true }).click(),
        ".dfwallet",
      );
      const output = panel.getByLabel(qLabel("requestText"), { exact: true });
      await output.waitFor();
      return output.inputValue();
    };
    const publishSources = async (request) => {
      const result = {};
      const panel = await management("issuer", "source");
      for (const kind of ["fact", "trust"]) {
        await panel.getByLabel(qLabel("incomingRequest"), { exact: true }).fill(request);
        await panel.getByLabel(qLabel("sourceKind"), { exact: true }).selectOption(kind);
        await managePassword("issuer", panel);
        result[kind] = await waitForDownload(
          "issuer",
          () => panel.getByRole("button", { name: qLabel("publish"), exact: true }).click(),
          ".dfqualification",
        );
        await panel.getByText(qLabel("sourceConfirmed"), { exact: true }).waitFor();
      }
      return result;
    };
    const issueQualification = async (packages) => {
      const panel = await management("recipient", "request");
      for (const kind of ["fact", "trust"]) {
        await managePassword("recipient", panel);
        await waitForDownload(
          "recipient",
          () =>
            panel.getByLabel(qLabel("packageFile"), { exact: true }).setInputFiles(packages[kind]),
          ".dfwallet",
        );
        await panel.getByText(qLabel("packageImported"), { exact: true }).waitFor();
      }
      await managePassword("recipient", panel);
      await panel
        .getByTestId("qualification-issue")
        .getByRole("button", { name: qLabel("issue"), exact: true })
        .click();
      await panel
        .getByTestId("qualification-issue")
        .getByText(qLabel("qualificationIssued"), { exact: true })
        .waitFor();
    };
    const request = await step(
      "recipient creates identity-bound qualification request",
      createRequest,
    );
    const packages = await step(
      "issuer publishes actual fact and trust proofs and encrypted handoffs",
      () => publishSources(request),
    );
    await step(
      "recipient imports encrypted source handoffs and registers actual qualification proof",
      () => issueQualification(packages),
    );
    const makeRule = async () => {
      const page = await task("recipient", "receive");
      const previous = (await page.getByLabel(walletLabel("rule"), { exact: true }).count())
        ? await page.getByLabel(walletLabel("rule"), { exact: true }).inputValue()
        : "";
      await field(page, walletLabel("amountPerPeriod"), { prefix: true }).fill("0.00001");
      await field(page, walletLabel("periodDays")).fill("1");
      await page.getByRole("button", { name: walletLabel("createRule"), exact: true }).click();
      await page.getByText(walletLabel("ruleReady"), { exact: true }).waitFor();
      await page.waitForFunction(
        ({ label, previous }) =>
          Array.from(document.querySelectorAll("textarea")).some(
            (item) =>
              item.getAttribute("aria-label") === label && item.value && item.value !== previous,
          ),
        { label: walletLabel("rule"), previous },
      );
      return page.getByLabel(walletLabel("rule"), { exact: true }).inputValue();
    };
    const rule = await step("recipient creates future budget rule", makeRule);
    const unusedRule = await step(
      "recipient creates independent rule for first-deposit revocation check",
      makeRule,
    );
    const code = await step("recipient generates reusable qualified receive code", async () => {
      const page = await task("recipient", "receive");
      await enterPassword("recipient");
      await waitForDownload(
        "recipient",
        () => page.getByRole("button", { name: walletLabel("generateCode"), exact: true }).click(),
        ".dfwallet",
      );
      return page.getByLabel(walletLabel("receiveCode"), { exact: true }).inputValue();
    });
    const recipientBackup = await latestBackup("recipient");
    await step("recipient goes offline with encrypted backup preserved", async () => {
      await pages.recipient.context.close();
      delete pages.recipient;
      return { backupSha256: digest(await fs.readFile(recipientBackup)) };
    });
    const submitMoney = async (expected = "accepted") => {
      const page = pages.payer.page,
        submitted = report.transactions.length;
      await page.getByRole("button", { name: walletLabel("submit"), exact: true }).click();
      if (expected === "accepted") {
        const outcome = await Promise.race([
          page
            .getByText(walletLabel("confirmed"), { exact: true })
            .waitFor()
            .then(() => "confirmed"),
          page
            .locator('[role="alert"]')
            .last()
            .waitFor()
            .then(() => "rejected"),
        ]);
        if (outcome !== "confirmed")
          throw new Error(
            `Money action rejected: ${await page.locator('[role="alert"]').last().textContent()}`,
          );
        assert.ok(
          report.transactions.length > submitted,
          "Accepted money action must broadcast an actual transaction",
        );
      } else {
        await page.locator('[role="alert"]').last().waitFor();
        assert.equal(
          report.transactions.length,
          submitted,
          "Revoked qualification must fail before transaction submission",
        );
      }
    };
    await step("payer shields actual native collateral through page", async () => {
      const page = await task("payer", "shield");
      await field(page, walletLabel("amount"), { prefix: true }).fill("0.01");
      await submitMoney();
    });
    const fillBudget = async (selectedRule = rule) => {
      const page = await task("payer", "budget");
      await field(page, walletLabel("receiveCode")).fill(code);
      await field(page, walletLabel("rule")).fill(selectedRule);
      await field(page, walletLabel("periods")).fill("2");
      const balance = field(page, walletLabel("balanceSource"));
      const value = await balance.locator("option").nth(1).getAttribute("value");
      await balance.selectOption(value);
    };
    await step("offline recipient code accepts first actual budget deposit", async () => {
      await fillBudget();
      await submitMoney();
    });
    await step("same offline recipient code accepts actual append", async () => {
      await fillBudget();
      await submitMoney();
    });
    await step("issuer revokes authenticated fact roles through page", async () => {
      const panel = await management("issuer", "roles");
      const select = panel.getByLabel(qLabel("savedSource"), { exact: true });
      const options = await select.locator("option").allTextContents();
      const index = options.findIndex(
        (value) => value.includes(qLabel("fact")) && value.includes(qLabel("published")),
      );
      assert.ok(index > 0, "Published fact controller record must exist");
      await select.selectOption({ index });
      await panel.getByLabel(qLabel("confirmRevocation"), { exact: true }).check();
      await panel.getByRole("button", { name: qLabel("revoke"), exact: true }).click();
      await panel.getByText(qLabel("revoked"), { exact: true }).waitFor();
    });
    await step("revocation immediately prevents another append from old code", async () => {
      await fillBudget();
      await submitMoney("rejected");
    });
    await step("revocation immediately prevents first deposit under an unused rule", async () => {
      await fillBudget(unusedRule);
      await submitMoney("rejected");
    });
    await step(
      "ordinary transfer remains valid after family qualification revocation",
      async () => {
        const page = await task("payer", "transfer");
        await field(page, walletLabel("receiveCode")).fill(code);
        await field(page, walletLabel("amount"), { prefix: true }).fill("0.000003");
        const balance = field(page, walletLabel("balanceSource"));
        await balance.selectOption(await balance.locator("option").nth(1).getAttribute("value"));
        await submitMoney();
      },
    );
    const letter = `Family qualification was revoked; ordinary letter ${fixture.runId}`;
    await step(
      "ordinary encrypted letter remains valid after qualification revocation",
      async () => {
        const page = await task("payer", "letter");
        await field(page, walletLabel("receiveCode")).fill(code);
        await field(page, walletLabel("letterBody")).fill(letter);
        await submitMoney();
      },
    );
    await provider.send("evm_increaseTime", [2 * 86400]);
    await provider.send("evm_mine", []);
    await step("recipient restores backup and recovers offline funds and letter", async () => {
      const page = await open("recipient");
      await page
        .getByLabel(walletLabel("backupFile"), { exact: true })
        .setInputFiles(recipientBackup);
      await enterPassword("recipient");
      await page.getByRole("button", { name: walletLabel("restore"), exact: true }).click();
      await page.getByText(walletLabel("restored"), { exact: true }).waitFor();
      await page.getByText(letter, { exact: true }).waitFor();
      assert.ok(
        await page.getByRole("button", { name: walletLabel("claim"), exact: true }).count(),
      );
    });
    await step("revocation immediately prevents mature budget claim", async () => {
      const page = pages.recipient.page,
        submitted = report.transactions.length;
      await page
        .getByRole("button", { name: walletLabel("claim"), exact: true })
        .first()
        .click();
      await page.locator('[role="alert"]').last().waitFor();
      assert.equal(report.transactions.length, submitted);
    });
    const replacementRequest = await step(
      "recipient requests reissued qualification for the same family",
      createRequest,
    );
    const replacementPackages = await step(
      "issuer reissues source roles while retaining original family commitment",
      () => publishSources(replacementRequest),
    );
    await step(
      "recipient registers replacement qualification without replacing receiving keys",
      () => issueQualification(replacementPackages),
    );
    await step("replacement qualification claims original existing budget", async () => {
      const page = await task("recipient", "receive");
      await page.getByRole("button", { name: walletLabel("refresh"), exact: true }).click();
      const claim = page.getByRole("button", { name: walletLabel("claim"), exact: true }).first();
      await claim.click();
      await page.getByText(walletLabel("confirmed"), { exact: true }).waitFor();
    });
    report.receiptEvidence = await step(
      "reconcile actual receipts, replacement indices and original budget claim",
      () => verifyQualificationTransactionEvidence({ root: ROOT, provider, fixture, report }),
    );
    for (const [role, { page }] of Object.entries(pages))
      await page.screenshot({
        path: path.join(directory, `${role}-completed.png`),
        fullPage: true,
      });
    report.completed = true;
    console.log(
      `[qualification-acceptance] Completed ${report.steps.length} actual DOM stages; ${report.transactions.length} actual wallet transactions`,
    );
  } catch (error) {
    report.failure = error.message;
    for (const [role, { page }] of Object.entries(pages)) {
      await page
        .screenshot({ path: path.join(directory, `${role}-failure.png`), fullPage: true })
        .catch(() => {});
    }
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
    await runQualificationAcceptance();
  } catch (error) {
    console.error(`[qualification-acceptance] ${error.message}`);
    process.exitCode = 1;
  }
}
