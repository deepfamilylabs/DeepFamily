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

function TrustedDetailHarness({
  connectedAddress,
  addedBy,
  owner,
  tokenId,
  trustedAccounts,
}: {
  connectedAddress: string;
  addedBy: string;
  owner?: string;
  tokenId?: string;
  trustedAccounts: string[];
}) {
  const access = React.useMemo(
    () => ({
      connectedAddress,
      loadTrustedEndorsers: vi.fn(async () => trustedAccounts),
      addTrustedEndorser: vi.fn(async () => undefined),
      removeTrustedEndorser: vi.fn(async () => undefined),
    }),
    [connectedAddress, trustedAccounts],
  );

  return (
    <ToastProvider>
      <MemoryRouter>
        <NodeDetailModal
          open
          onClose={vi.fn()}
          nodeData={makePerson({ addedBy, owner, tokenId })}
          fallback={{ hash: personHash, versionIndex: 1 }}
          getOwnerOf={mocks.getOwnerOf}
          trustedEndorserAccess={access}
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

  it("renders NFT information before recommended sources", async () => {
    const contributor = "0x00000000000000000000000000000000000000aa";
    const owner = "0x00000000000000000000000000000000000000bb";
    const source = "0x00000000000000000000000000000000000000cc";

    render(
      <TrustedDetailHarness
        connectedAddress={owner}
        addedBy={contributor}
        owner={owner}
        tokenId="1"
        trustedAccounts={[source]}
      />,
    );

    await screen.findByText(source);

    const nftHeading = screen.getByText("familyTree.nodeDetail.nft");
    const trustedHeading = screen.getByText("Recommended Sources");
    expect(
      Boolean(
        nftHeading.compareDocumentPosition(trustedHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("shows trusted source management to the version contributor before mint", async () => {
    const contributor = "0x00000000000000000000000000000000000000aa";
    const source = "0x00000000000000000000000000000000000000bb";
    const { rerender } = render(
      <TrustedDetailHarness
        connectedAddress={contributor}
        addedBy={contributor}
        trustedAccounts={[source]}
      />,
    );

    await screen.findByText(source);
    expect(screen.getByRole("textbox", { name: "Recommended account address" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove recommended source" })).toBeTruthy();

    rerender(
      <TrustedDetailHarness
        connectedAddress="0x00000000000000000000000000000000000000cc"
        addedBy={contributor}
        trustedAccounts={[source]}
      />,
    );

    await screen.findByText(source);
    expect(screen.queryByRole("textbox", { name: "Recommended account address" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove recommended source" })).toBeNull();
  });

  it("shows trusted source management only to the NFT owner after mint", async () => {
    const contributor = "0x00000000000000000000000000000000000000aa";
    const owner = "0x00000000000000000000000000000000000000bb";
    const source = "0x00000000000000000000000000000000000000cc";
    const { rerender } = render(
      <TrustedDetailHarness
        connectedAddress={owner}
        addedBy={contributor}
        owner={owner}
        tokenId="1"
        trustedAccounts={[source]}
      />,
    );

    await screen.findByText(source);
    expect(screen.getByRole("textbox", { name: "Recommended account address" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove recommended source" })).toBeTruthy();

    rerender(
      <TrustedDetailHarness
        connectedAddress={contributor}
        addedBy={contributor}
        owner={owner}
        tokenId="1"
        trustedAccounts={[source]}
      />,
    );

    await screen.findByText(source);
    expect(screen.queryByRole("textbox", { name: "Recommended account address" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove recommended source" })).toBeNull();
  });
});
