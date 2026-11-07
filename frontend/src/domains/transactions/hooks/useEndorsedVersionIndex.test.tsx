// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEndorsedVersionIndex, useEndorsedVersionLookup } from "./useEndorsedVersionIndex";

const personHash = `0x${"12".repeat(32)}`;
const address = `0x${"34".repeat(20)}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(cleanup);

describe("useEndorsedVersionLookup", () => {
  it("distinguishes an unanswered query from a confirmed absence of endorsement", async () => {
    const response = deferred<bigint>();
    const contract = { endorsedVersionIndex: vi.fn(() => response.promise) };
    const { result } = renderHook(() => useEndorsedVersionLookup(personHash, address, contract));

    expect(result.current).toEqual({ personHash, versionIndex: 0, status: "loading" });
    await act(async () => response.resolve(0n));
    expect(result.current).toEqual({ personHash, versionIndex: 0, status: "ready" });
  });

  it("does not turn a failed lookup into a confirmed zero", async () => {
    const response = deferred<bigint>();
    const contract = { endorsedVersionIndex: vi.fn(() => response.promise) };
    const { result } = renderHook(() => useEndorsedVersionLookup(personHash, address, contract));

    await act(async () => response.reject(new Error("RPC unavailable")));
    expect(result.current).toEqual({ personHash, versionIndex: 0, status: "error" });
  });

  it.each(["person", "wallet", "contract"] as const)(
    "hides the previous %s scope's completed answer before effects run",
    async (change) => {
      const pending = deferred<bigint>();
      const original = { endorsedVersionIndex: vi.fn().mockResolvedValueOnce(2n) };
      const replacement = { endorsedVersionIndex: vi.fn(() => pending.promise) };
      original.endorsedVersionIndex.mockImplementationOnce(() => pending.promise);
      const seen: Array<{ status: string; versionIndex: number }> = [];
      const initialProps = { personHash, address, contract: original };
      const { result, rerender } = renderHook(
        (props) => {
          const lookup = useEndorsedVersionLookup(props.personHash, props.address, props.contract);
          seen.push(lookup);
          return lookup;
        },
        { initialProps },
      );
      await waitFor(() => expect(result.current.versionIndex).toBe(2));

      seen.length = 0;
      rerender({
        personHash: change === "person" ? `0x${"56".repeat(32)}` : personHash,
        address: change === "wallet" ? `0x${"78".repeat(20)}` : address,
        contract: change === "contract" ? replacement : original,
      });
      expect(seen[0]).toMatchObject({ versionIndex: 0, status: "loading" });
      expect(result.current).toMatchObject({ versionIndex: 0, status: "loading" });

      await act(async () => pending.resolve(3n));
      expect(result.current).toMatchObject({ versionIndex: 3, status: "ready" });
    },
  );

  it("ignores a late answer for the previous person", async () => {
    const previous = deferred<bigint>();
    const current = deferred<bigint>();
    const contract = {
      endorsedVersionIndex: vi
        .fn()
        .mockImplementationOnce(() => previous.promise)
        .mockImplementationOnce(() => current.promise),
    };
    const { result, rerender } = renderHook(
      ({ hash }) => useEndorsedVersionLookup(hash, address, contract),
      { initialProps: { hash: personHash } },
    );
    const currentHash = `0x${"9a".repeat(32)}`;
    rerender({ hash: currentHash });
    await act(async () => previous.resolve(2n));
    expect(result.current).toEqual({
      personHash: currentHash,
      versionIndex: 0,
      status: "loading",
    });
    await act(async () => current.resolve(3n));
    expect(result.current).toEqual({ personHash: currentHash, versionIndex: 3, status: "ready" });
  });

  it("returns idle when no query can be made", () => {
    const { result } = renderHook(() => useEndorsedVersionLookup(personHash, null, undefined));
    expect(result.current).toEqual({ personHash, versionIndex: 0, status: "idle" });
  });

  it("keeps the numeric hook API for existing callers", async () => {
    const contract = { endorsedVersionIndex: vi.fn().mockResolvedValue(2n) };
    const { result } = renderHook(() => useEndorsedVersionIndex(personHash, address, contract));
    await waitFor(() => expect(result.current).toBe(2));
  });
});
