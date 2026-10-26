import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLatestEncryptedWalletBackup, saveEncryptedWalletBackup } from "./walletBackupStore";

afterEach(() => vi.unstubAllGlobals());
const scope = { chainId: "31337", registryAddress: "0x1111111111111111111111111111111111111111" };
describe("encrypted wallet recovery storage", () => {
  it("commits ciphertext before resolving and isolates recovery by chain and registry", async () => {
    vi.stubGlobal("indexedDB", indexedDB);
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const first = Uint8Array.of(1, 3, 5),
      latest = Uint8Array.of(2, 4, 6);
    const clock = vi.spyOn(Date, "now").mockReturnValue(100);
    try {
      await saveEncryptedWalletBackup(scope, first);
      await saveEncryptedWalletBackup(scope, latest);
    } finally {
      clock.mockRestore();
    }
    latest.fill(0);
    expect(await readLatestEncryptedWalletBackup(scope)).toEqual(Uint8Array.of(2, 4, 6));
    expect(await readLatestEncryptedWalletBackup({ ...scope, chainId: "1337" })).toBeNull();
    expect(
      await readLatestEncryptedWalletBackup({
        ...scope,
        registryAddress: "0x2222222222222222222222222222222222222222",
      }),
    ).toBeNull();
  });
  it("rejects failed writes so callers can stop before publishing controller roles", async () => {
    vi.stubGlobal("indexedDB", {
      open() {
        throw new Error("Storage blocked");
      },
    });
    await expect(saveEncryptedWalletBackup(scope, Uint8Array.of(7, 8, 9))).rejects.toThrow(
      "Storage blocked",
    );
  });
});
