import { describe, expect, it, vi } from "vitest";
import { estimateGasWithFallback, parseReceiptEvents } from "./txGateway";
import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";

describe("txGateway estimateGasWithFallback", () => {
  it("returns buffered gas estimate when estimateGas succeeds", async () => {
    const contractMethod = Object.assign(vi.fn(), {
      estimateGas: vi.fn(async () => 1000n),
      staticCall: vi.fn(),
    });

    const gasLimit = await estimateGasWithFallback({
      contractMethod,
      args: [] as const,
      fallbackGas: 6_500_000n,
    });

    expect(gasLimit).toBe(1200n);
    expect(contractMethod.estimateGas).toHaveBeenCalledTimes(1);
    expect(contractMethod.staticCall).not.toHaveBeenCalled();
  });

  it("falls back to configured gas limit after a successful static call", async () => {
    const contractMethod = Object.assign(vi.fn(), {
      estimateGas: vi.fn(async () => {
        throw new Error("estimate failed");
      }),
      staticCall: vi.fn(async () => undefined),
    });

    const gasLimit = await estimateGasWithFallback({
      contractMethod,
      args: [] as const,
      fallbackGas: 6_500_000n,
    });

    expect(gasLimit).toBe(6_500_000n);
    expect(contractMethod.staticCall).toHaveBeenCalledTimes(1);
  });
});

describe("txGateway parseReceiptEvents", () => {
  it("parses only logs for the target contract", () => {
    const eventInterface = createDeepFamilyInterface();
    const endorseEvent = eventInterface.getEvent("PersonVersionEndorsed");
    if (!endorseEvent) {
      throw new Error("PersonVersionEndorsed event ABI missing");
    }
    const log = eventInterface.encodeEventLog(
      endorseEvent,
      [
        "0x00000000000000000000000000000000000000000000000000000000000000aa",
        "0x00000000000000000000000000000000000000bb",
        2,
        "0x00000000000000000000000000000000000000cc",
        1n,
        "0x00000000000000000000000000000000000000dd",
        1n,
        2n,
        123n,
      ],
    );

    const parsed = parseReceiptEvents(
      {
        logs: [
          {
            address: "0x0000000000000000000000000000000000000abc",
            topics: log.topics,
            data: log.data,
          },
          {
            address: "0x0000000000000000000000000000000000000def",
            topics: log.topics,
            data: log.data,
          },
        ],
      },
      eventInterface,
      "0x0000000000000000000000000000000000000abc",
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("PersonVersionEndorsed");
    expect(Number(parsed[0]?.args.versionIndex)).toBe(2);
  });
});
