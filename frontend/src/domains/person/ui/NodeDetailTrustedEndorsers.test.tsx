// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeDetailTrustedEndorsersSection } from "./NodeDetailModalSections";

afterEach(cleanup);

const t: any = (_k: string, d?: any) => (typeof d === "string" ? d : _k);
const ME = "0x8c1e77b409ad3f2650c8b1e0d7a4f39c2b6e0417";
const SOMEONE_ELSE = "0x2f77c3d19ae5307f24b1cc98da6053e17f2b40a9";
const HASH = `0x${"1".repeat(64)}`;

function makeAccess() {
  return {
    connectedAddress: ME,
    loadTrustedEndorsers: vi.fn(async () => []),
    addTrustedEndorser: vi.fn(async () => {}),
    removeTrustedEndorser: vi.fn(async () => {}),
  };
}

function renderSection(nodeData: any, owner?: string, managerResolving = true) {
  const access = makeAccess();
  render(
    <NodeDetailTrustedEndorsersSection
      t={t}
      nodeData={nodeData}
      access={access as any}
      owner={owner}
      onCopy={() => {}}
      managerResolving={managerResolving}
    />,
  );
  return access;
}

const shallow = { personHash: HASH, versionIndex: 1 };

describe("NodeDetailTrustedEndorsersSection edit affordance", () => {
  it("reports that it is still checking while the manager address is unresolved", async () => {
    // A first open starts from the shallow graph node: `addedBy` has not been
    // merged yet, so permission is unknown rather than denied.
    const access = renderSection(shallow);
    await waitFor(() => expect(access.loadTrustedEndorsers).toHaveBeenCalled());
    expect(screen.getByText("Checking edit permission…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("offers the editor once the submitter arrives with the version details", async () => {
    const access = renderSection({ ...shallow, addedBy: ME }, undefined, false);
    await waitFor(() => expect(access.loadTrustedEndorsers).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.queryByText("Checking edit permission…")).toBeNull();
  });

  it("falls back to read-only once the lookup settles with no manager", async () => {
    // A missing NFT contract or a failed version-details read must not leave the
    // permission check spinning forever.
    const access = renderSection({ ...shallow, tokenId: "482" }, undefined, false);
    await waitFor(() => expect(access.loadTrustedEndorsers).toHaveBeenCalled());
    expect(screen.queryByText("Checking edit permission…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("stays read-only for a version someone else manages", async () => {
    const access = renderSection({ ...shallow, addedBy: SOMEONE_ELSE }, undefined, false);
    await waitFor(() => expect(access.loadTrustedEndorsers).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByText("Checking edit permission…")).toBeNull();
  });

  it("keeps checking after minting until the NFT owner resolves", async () => {
    // tokenId flips the manager from the submitter to the NFT owner, which is
    // fetched separately — the gap must not read as "not permitted".
    const access = renderSection({ ...shallow, addedBy: ME, tokenId: "482" });
    await waitFor(() => expect(access.loadTrustedEndorsers).toHaveBeenCalled());
    expect(screen.getByText("Checking edit permission…")).toBeTruthy();

    cleanup();
    const next = renderSection({ ...shallow, addedBy: ME, tokenId: "482" }, ME, false);
    await waitFor(() => expect(next.loadTrustedEndorsers).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
});
