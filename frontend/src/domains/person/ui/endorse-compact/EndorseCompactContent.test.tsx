// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EndorseCompactModal from "./EndorseCompactContent";
import { OVERLAY_Z_INDEX } from "../../../../shared/ui";

const personHash = `0x${"ab".repeat(32)}`;

const mocks = vi.hoisted(() => ({
  getVersionDetails: vi.fn(),
  resetEndorseFlow: vi.fn(),
  runEndorseFlow: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../../wallet", () => ({
  useWallet: () => ({
    address: null,
  }),
}));

vi.mock("../../../transactions", () => ({
  useContractClient: () => ({
    getVersionDetails: mocks.getVersionDetails,
  }),
  useEndorseFlow: () => ({
    status: "idle",
    result: null,
    error: null,
    stepMessage: null,
    reset: mocks.resetEndorseFlow,
    run: mocks.runEndorseFlow,
  }),
}));

function zValue(className: string) {
  // Accept both the v3 arbitrary form (z-[10040]) and the v4 bare value (z-10040).
  return Number(className.match(/z-\[?(\d+)\]?/)?.[1] ?? 0);
}

describe("EndorseCompactModal", () => {
  beforeEach(() => {
    mocks.getVersionDetails.mockReset();
    mocks.resetEndorseFlow.mockReset();
    mocks.runEndorseFlow.mockReset();
    mocks.getVersionDetails.mockResolvedValue(null);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(
      (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders above app modals when opened from another modal", () => {
    render(
      <EndorseCompactModal
        isOpen
        onClose={vi.fn()}
        personHash={personHash}
        versionIndex={1}
        versionData={{ fullName: "Ada Lovelace", endorsementCount: 7 }}
      />,
    );

    const modalLayer = screen.getByRole("dialog", { name: "Endorse Version" }).parentElement;

    expect(modalLayer?.className).toContain(OVERLAY_Z_INDEX.nestedModal);
    expect(zValue(OVERLAY_Z_INDEX.nestedModal)).toBeGreaterThan(zValue(OVERLAY_Z_INDEX.appModal));
  });
});
