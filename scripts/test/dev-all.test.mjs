import assert from "node:assert/strict";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDevAll } from "../dev-all.mjs";

const HOST = "127.0.0.1";

async function listen(t, port = 0) {
  const server = createServer();
  await once(server.listen(port, HOST), "listening");
  t.after(async () => {
    if (server.listening) await once(server.close(), "close");
  });
  return server;
}

async function fixture(t, { fail = false } = {}) {
  const rpc = await listen(t);
  const web = await listen(t);
  const rpcPort = rpc.address().port;
  const webPort = web.address().port;
  const cwd = await mkdtemp(join(tmpdir(), "deepfamily-dev-all-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      scripts: {
        "dev:node": `node fixture.mjs node ${rpcPort} ${fail}`,
        "dev:contract": "node fixture.mjs deploy",
        "frontend:config": "node fixture.mjs configure",
        "frontend:dev": "node fixture.mjs frontend",
      },
    }),
  );
  await writeFile(
    join(cwd, "fixture.mjs"),
    `import { appendFileSync } from "node:fs";
import { createServer } from "node:net";
const [step, port, fail] = process.argv.slice(2);
const record = (step) => appendFileSync("steps.log", step + "\\n");
record(step);
if (step === "node") {
  const server = createServer().listen(Number(port), "${HOST}", () => {
    record("bound");
    if (fail === "true") {
      server.close();
      process.exitCode = 1;
      return;
    }
    process.stdout.write("\\x1b[32mStarted HTTP and WebSocket ");
    setTimeout(() => {
      record("ready");
      console.log("JSON-RPC server at http://${HOST}:" + port + "/\\x1b[39m");
    }, 25);
  });
  setTimeout(() => server.close(), 10_000).unref();
}`,
  );
  return { rpc, web, options: { rpcPort, webPort, cwd }, steps: join(cwd, "steps.log") };
}

test("an occupied RPC or frontend port stops dev:all before running any commands", async (t) => {
  const { rpc, options, steps } = await fixture(t);
  await assert.rejects(runDevAll(options), /Hardhat RPC port .* is already in use/);
  assert.equal(rpc.listening, true);
  await once(rpc.close(), "close");
  await assert.rejects(runDevAll(options), /Vite port .* is already in use/);
  await assert.rejects(access(steps), { code: "ENOENT" });
});

test("a TCP listener alone cannot start deployment if Hardhat fails before announcing readiness", async (t) => {
  const { rpc, web, options, steps } = await fixture(t, { fail: true });
  await Promise.all([once(rpc.close(), "close"), once(web.close(), "close")]);
  await assert.rejects(runDevAll(options), /Hardhat exited before it was ready/);
  assert.equal(await readFile(steps, "utf8"), "node\nbound\n");
});

test("deployment and the frontend start in order once Hardhat is ready", async (t) => {
  const { rpc, web, options, steps } = await fixture(t);
  await Promise.all([once(rpc.close(), "close"), once(web.close(), "close")]);
  assert.equal(await runDevAll(options), 0);
  assert.equal(await readFile(steps, "utf8"), "node\nbound\nready\ndeploy\nconfigure\nfrontend\n");
  await listen(t, options.rpcPort);
});
