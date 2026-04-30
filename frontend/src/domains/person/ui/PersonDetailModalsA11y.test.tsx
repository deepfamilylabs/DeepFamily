// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import NodeDetailModal from "./NodeDetailModal";
import { makeNodeId, type NodeData } from "../../../shared/model";
import { ToastProvider } from "../../../shared/ui";

const personHash = `0x${"ab".repeat(32)}`;

const mocks = vi.hoisted(() => ({
  getOwnerOf: vi.fn(),
  openEndorse: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: any) => {
      if (typeof fallbackOrOptions === "string") {
        return fallbackOrOptions.replace(/{{\s*(\w+)\s*}}/g, (_match, key) =>
          String(options?.[key] ?? ""),
        );
      }
      if (fallbackOrOptions && typeof fallbackOrOptions === "object") {
        return String(fallbackOrOptions.defaultValue ?? _key).replace(
          /{{\s*(\w+)\s*}}/g,
          (_match, key) => String((fallbackOrOptions as Record<string, unknown>)[key] ?? ""),
        );
      }
      return _key;
    },
  }),
}));

vi.mock("./EndorseModalProvider", () => ({
  useEndorseModal: () => ({
    openEndorse: mocks.openEndorse,
  }),
}));

function makePerson(overrides: Partial<NodeData> = {}): NodeData {
  const versionIndex = overrides.versionIndex ?? 1;
  return {
    personHash,
    versionIndex,
    id: makeNodeId(personHash, versionIndex),
    fullName: "Ada Lovelace",
    endorsementCount: 1,
    ...overrides,
  };
}

function NodeDetailHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = React.useState(true);
  const handleClose = () => {
    onClose();
    setOpen(false);
  };

  return (
    <ToastProvider>
      <MemoryRouter>
        <NodeDetailModal
          open={open}
          onClose={handleClose}
          nodeData={makePerson()}
          fallback={{ hash: personHash, versionIndex: 1 }}
          getOwnerOf={mocks.getOwnerOf}
        />
      </MemoryRouter>
    </ToastProvider>
  );
}

describe("person detail modals a11y", () => {
  beforeEach(() => {
    mocks.getOwnerOf.mockResolvedValue(undefined);
    mocks.openEndorse.mockReset();
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

  it("exposes NodeDetailModal as a labelled dialog and closes from Escape", async () => {
    const onClose = vi.fn();

    render(<NodeDetailHarness onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "familyTree.personVersionDetail.title" });

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", { name: "familyTree.personVersionDetail.title" }),
    ).toBeNull();
  });

  it("uses the global toast for copy feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<NodeDetailHarness onClose={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(personHash));
    expect(screen.getByRole("status").textContent).toContain("search.copied");
  });
});
