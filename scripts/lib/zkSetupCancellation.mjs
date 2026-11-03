import { spawn } from "node:child_process";
import path from "node:path";

import { normalizePortableCommand } from "./portableCommand.mjs";

/** Keep signal handlers installed until commands, rollback and cleanup have all finished. */
export const runWithSetupSignalHandlers = async (
  operation,
  { signalSource = process, onSignal } = {},
) => {
  const controller = new AbortController();
  const handlers = new Map(
    ["SIGINT", "SIGTERM"].map((signalName) => [
      signalName,
      () => {
        if (controller.signal.aborted) return;
        const error = new Error(`ZK setup cancelled by ${signalName}`);
        error.name = "AbortError";
        error.exitCode = signalName === "SIGINT" ? 130 : 143;
        controller.abort(error);
        onSignal?.(signalName);
      },
    ]),
  );
  for (const [signalName, handler] of handlers) signalSource.on(signalName, handler);
  try {
    const result = await operation(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    for (const [signalName, handler] of handlers) signalSource.removeListener(signalName, handler);
  }
};

/** Run each command in its own process group so cancelling npm also stops its children. */
export const runSetupCommand = ({
  executable,
  args,
  cwd,
  stdin = null,
  env = process.env,
  capture = false,
  signal,
}) => {
  signal?.throwIfAborted();
  const command = normalizePortableCommand({ executable, args, platform: process.platform, env });
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: [stdin === null ? "ignore" : "pipe", capture ? "pipe" : "inherit", "inherit"],
    });
    const output = [];
    let commandError;
    let terminationError;
    let stopping = false;
    let killTimer;
    let treeStopped = Promise.resolve();
    const failedToStopTree = (cause) => {
      terminationError ??= Object.assign(
        new Error(`Unable to stop the ZK setup command tree: ${cause.message}`, { cause }),
        { processesMayBeRunning: true },
      );
    };
    const killGroup = (signalName) => {
      if (!(child.pid > 0)) return;
      try {
        process.kill(-child.pid, signalName);
      } catch (error) {
        if (error.code !== "ESRCH") failedToStopTree(error);
      }
    };
    const stop = () => {
      if (stopping || !(child.pid > 0)) return;
      stopping = true;
      if (process.platform === "win32") {
        // Node's child.kill() only stops the direct process on Windows.
        treeStopped = new Promise((done) => {
          const taskkill = spawn(
            path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
            ["/PID", String(child.pid), "/T", "/F"],
            { stdio: "ignore", windowsHide: true },
          );
          taskkill.once("error", (error) => {
            failedToStopTree(error);
            child.kill("SIGKILL");
          });
          taskkill.once("close", (code) => {
            if (code !== 0) {
              failedToStopTree(new Error(`taskkill exited with code ${String(code)}`));
              child.kill("SIGKILL");
            }
            done();
          });
        });
      } else {
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), 1_000);
      }
    };
    child.stdout?.on("data", (chunk) => output.push(chunk));
    child.once("error", (error) => {
      commandError ??= error;
    });
    child.once("close", async (code, exitSignal) => {
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", stop);
      // A wrapper can exit before a descendant that ignored SIGTERM. Stop that remainder too.
      if (stopping && process.platform !== "win32") killGroup("SIGKILL");
      await treeStopped;
      if (terminationError) reject(terminationError);
      else if (signal?.aborted) reject(signal.reason);
      else if (commandError) reject(commandError);
      else if (code === 0) resolve(capture ? Buffer.concat(output).toString("utf8") : undefined);
      else {
        reject(
          new Error(
            `${path.basename(executable)} exited with ` +
              (exitSignal ? `signal ${exitSignal}` : `code ${String(code)}`),
          ),
        );
      }
    });
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    if (stdin !== null) {
      child.stdin.once("error", (error) => {
        if (error.code === "EPIPE") return;
        commandError ??= error;
        stop();
      });
      child.stdin.end(stdin);
    }
  });
};
