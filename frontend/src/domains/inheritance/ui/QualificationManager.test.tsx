// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QualificationManager, type QualificationOperation } from "./QualificationManager";
import type { QualificationManagementView } from "../../../shared/workers/walletWorkerTypes";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const label = (key: string) => `qualificationManager.${key}`;
const state = { unlocked: true, codeCount: "1", credentialCount: 0, backupChanged: false };
const backup = new Uint8Array([1, 2, 3]);
const proof = {
  pi_a: [1n, 2n],
  pi_b: [
    [1n, 2n],
    [3n, 4n],
  ],
  pi_c: [1n, 2n],
};
const view: QualificationManagementView = { canRequest: true, requests: [], sources: [] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup(management = view) {
  let current = true;
  const events: string[] = [],
    errors: unknown[] = [];
  const send = vi.fn(async () => {
    events.push("send");
    return { hash: `0x${"a".repeat(64)}`, wait: async () => ({ status: 1 }) };
  });
  const call = vi.fn(async (method: string) => {
    if (method === "walletReadQualificationManagement") return management;
    if (method === "walletPrepareSourcePublication") {
      events.push("prepare");
      return { draftId: "source-id", kind: "fact", proof, publicSignals: [], state, backup };
    }
    if (method === "walletConfirmSourcePublication") {
      events.push("confirm");
      return { state, backup, package: new Uint8Array([4, 5, 6]) };
    }
    if (method === "walletCreateQualificationRequest")
      return { state, backup, requestId: "request-id", request: "public-request" };
    throw new Error(`Unexpected method ${method}`);
  });
  const operation = {
    worker: { call },
    context: { deployment: { chainId: 31337n } },
    account: "0x1111111111111111111111111111111111111111",
    chain: { sendSourceFact: send, sendSourceTrust: send },
    assertCurrent() {
      if (!current) throw new Error("wallet changed");
    },
  } as unknown as QualificationOperation;
  const save = vi.fn(async () => {
    events.push("backup");
  });
  const changed = vi.fn(async () => {});
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  };
  const mounted = render(
    <QualificationManager
      busy={false}
      openOperation={() => operation}
      run={run}
      save={save}
      changed={changed}
    />,
  );
  return {
    ...mounted,
    call,
    send,
    events,
    errors,
    save,
    changed,
    cancel: () => {
      current = false;
    },
  };
}
beforeEach(() => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:package"), revokeObjectURL: vi.fn() }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const password = () =>
  fireEvent.change(screen.getByLabelText(label("backupPassword")), {
    target: { value: "updated encrypted backup password" },
  });

describe("qualification management transaction lifecycle", () => {
  it("saves controller recovery material before publishing and only exports after canonical confirmation", async () => {
    const test = setup();
    await waitFor(() =>
      expect(test.call).toHaveBeenCalledWith(
        "walletReadQualificationManagement",
        {},
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: label("source") }));
    fireEvent.change(screen.getByLabelText(label("incomingRequest")), {
      target: { value: "public request" },
    });
    password();
    fireEvent.click(screen.getByRole("button", { name: label("publish") }));
    await screen.findByText(label("sourceConfirmed"));
    expect(test.events).toEqual(["prepare", "backup", "send", "confirm", "backup"]);
    expect(test.call).toHaveBeenCalledWith(
      "walletPrepareSourcePublication",
      expect.objectContaining({
        request: "public request",
        controller: "0x1111111111111111111111111111111111111111",
      }),
      expect.anything(),
    );
    expect(test.errors).toEqual([]);
    expect(screen.getByLabelText(label("backupPassword"))).toHaveProperty("value", "");
  });
  it("does not sign after the wallet changes while a proof and backup are being prepared", async () => {
    const test = setup(),
      pending = deferred<unknown>();
    const original = test.call.getMockImplementation()!;
    test.call.mockImplementation((method) =>
      method === "walletPrepareSourcePublication" ? (pending.promise as never) : original(method),
    );
    await waitFor(() => expect(test.call).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: label("source") }));
    fireEvent.change(screen.getByLabelText(label("incomingRequest")), {
      target: { value: "public request" },
    });
    password();
    fireEvent.click(screen.getByRole("button", { name: label("publish") }));
    await waitFor(() =>
      expect(test.call).toHaveBeenCalledWith(
        "walletPrepareSourcePublication",
        expect.anything(),
        expect.anything(),
      ),
    );
    test.cancel();
    await act(async () => {
      pending.resolve({ draftId: "draft", kind: "fact", proof, publicSignals: [], state, backup });
      await pending.promise;
    });
    expect(test.send).not.toHaveBeenCalled();
    expect(test.save).not.toHaveBeenCalled();
    expect(test.errors[0]).toHaveProperty("message", "wallet changed");
  });
  it("waits for durable backup storage and stops publication when that write fails", async () => {
    const test = setup(),
      storage = deferred<void>();
    test.save.mockImplementation(() => storage.promise);
    await waitFor(() => expect(test.call).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: label("source") }));
    fireEvent.change(screen.getByLabelText(label("incomingRequest")), {
      target: { value: "public request" },
    });
    password();
    fireEvent.click(screen.getByRole("button", { name: label("publish") }));
    await waitFor(() => expect(test.save).toHaveBeenCalledTimes(1));
    expect(test.send).not.toHaveBeenCalled();
    await act(async () => {
      storage.reject(new Error("Storage unavailable"));
      await storage.promise.catch(() => {});
    });
    expect(test.send).not.toHaveBeenCalled();
    expect(test.errors[0]).toHaveProperty("message", "Storage unavailable");
    expect(test.events).not.toContain("backup");
  });
  it("recovers an already confirmed publication without broadcasting it again", async () => {
    const test = setup({
      ...view,
      sources: [
        {
          id: "source-id",
          requestId: "request-id",
          request: "public request",
          kind: "fact",
          childPersonHash: "0x1234",
          parentPersonHash: "0x5678",
          parentVersion: "1",
          endorser: "0xabc",
          controller: "0xabc",
          published: false,
          revoked: false,
        },
      ],
    });
    await waitFor(() => expect(test.call).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: label("roles") }));
    await screen.findByRole("button", { name: label("confirmPublication") });
    fireEvent.change(screen.getByLabelText(label("sourceTransaction")), {
      target: { value: `0x${"b".repeat(64)}` },
    });
    password();
    fireEvent.click(screen.getByRole("button", { name: label("confirmPublication") }));
    await screen.findByText(label("sourceConfirmed"));
    expect(test.send).not.toHaveBeenCalled();
    expect(test.call).toHaveBeenCalledWith(
      "walletConfirmSourcePublication",
      expect.objectContaining({ draftId: "source-id", transactionHash: `0x${"b".repeat(64)}` }),
      expect.anything(),
    );
  });
  it("creates a public request without invoking a signer", async () => {
    const test = setup();
    await screen.findByLabelText(label("parentHash"));
    fireEvent.change(screen.getByLabelText(label("parentHash")), {
      target: { value: `0x${"c".repeat(64)}` },
    });
    fireEvent.change(screen.getByLabelText(label("endorser")), {
      target: { value: `0x${"d".repeat(40)}` },
    });
    password();
    fireEvent.click(screen.getByRole("button", { name: label("createRequest") }));
    await screen.findByText(label("requestCreated"));
    expect(test.save).toHaveBeenCalledTimes(1);
    expect(test.send).not.toHaveBeenCalled();
    expect(test.errors).toEqual([]);
  });
});
