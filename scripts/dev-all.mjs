import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import concurrently from "concurrently";

const HOST = "127.0.0.1";
const RPC_PORT = 8545;
const WEB_PORT = 5173;

async function checkPort(port, service) {
  const server = createServer((socket) => socket.destroy());
  try {
    await once(server.listen({ host: HOST, port }), "listening");
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    throw new Error(
      `${service} port ${HOST}:${port} is already in use. Stop its listener before starting a fresh dev stack.`,
      { cause: error },
    );
  }
  await once(server.close(), "close");
}

function start(name, command, prefixColor, cwd) {
  const {
    commands: [child],
    result,
  } = concurrently([{ name, command, prefixColor }], { cwd });
  return {
    child,
    done: result.then(
      () => 0,
      () => 1,
    ),
  };
}

async function waitForHardhat({ child, done }, port) {
  const rpcUrl = `http://${HOST}:${port}/`;
  const readyLine = `Started HTTP and WebSocket JSON-RPC server at ${rpcUrl}`;
  const { promise, resolve, reject } = Promise.withResolvers();
  let partialLine = "";

  // Only this Hardhat process can announce that it has bound the RPC port.
  const stdout = child.stdout.subscribe((chunk) => {
    const lines = (partialLine + chunk.toString()).split("\n");
    partialLine = lines.pop();
    if (lines.some((line) => stripVTControlCharacters(line).trimEnd() === readyLine)) resolve(true);
  });
  const timeout = setTimeout(
    () => reject(new Error(`Timed out waiting for Hardhat at ${rpcUrl}`)),
    60_000,
  );
  try {
    const ready = await Promise.race([promise, done.then(() => false)]);
    if (child.killed) return false;
    if (!ready || child.state !== "started") {
      throw new Error(`Hardhat exited before it was ready at ${rpcUrl}`);
    }
    return true;
  } finally {
    clearTimeout(timeout);
    stdout.unsubscribe();
  }
}

export async function runDevAll({ rpcPort = RPC_PORT, webPort = WEB_PORT, cwd } = {}) {
  await checkPort(rpcPort, "Hardhat RPC");
  await checkPort(webPort, "Vite");

  const node = start("node", "npm run dev:node", "blue", cwd);
  let web;
  try {
    if (!(await waitForHardhat(node, rpcPort))) return await node.done;
    web = start(
      "web",
      "npm run dev:contract && npm run frontend:config && " +
        `npm run frontend:dev -- --host ${HOST} --port ${webPort} --strictPort`,
      "green",
      cwd,
    );
    return await Promise.race([node.done, web.done]);
  } finally {
    node.child.kill();
    web?.child.kill();
    await Promise.all([node.done, web?.done]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runDevAll();
  } catch (error) {
    console.error(`[dev:all] ${error.message}`);
    process.exitCode = 1;
  }
}
