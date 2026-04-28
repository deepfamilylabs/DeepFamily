// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EndorseModalProvider, useEndorseModal } from "./EndorseModalProvider";

const mocks = vi.hoisted(() => ({
  bumpEndorsementCount: vi.fn(),
}));

vi.mock("../../tree", () => ({
  useTreeMutations: () => ({
    bumpEndorsementCount: mocks.bumpEndorsementCount,
  }),
}));

vi.mock("./EndorseCompactModal", () => ({
  default: (props: any) => (
    <div data-testid="endorse-modal" data-open={props.isOpen ? "true" : "false"}>
      <div data-testid="person-hash">{props.personHash}</div>
      <div data-testid="version-index">{String(props.versionIndex)}</div>
      <div data-testid="full-name">{props.versionData?.fullName ?? ""}</div>
      <div data-testid="endorsement-count">{String(props.versionData?.endorsementCount ?? "")}</div>
      <button type="button" onClick={props.onSuccess}>
        success
      </button>
      <button type="button" onClick={props.onClose}>
        close
      </button>
    </div>
  ),
}));

function Harness() {
  const { openEndorse } = useEndorseModal();
  return (
    <button
      type="button"
      onClick={() =>
        openEndorse({
          personHash: "0xperson",
          versionIndex: 2,
          fullName: "Ada Lovelace",
          endorsementCount: 7,
        })
      }
    >
      open
    </button>
  );
}

describe("EndorseModalProvider", () => {
  beforeEach(() => {
    mocks.bumpEndorsementCount.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the compact modal with the selected target and bumps count on success", async () => {
    render(
      <EndorseModalProvider>
        <Harness />
      </EndorseModalProvider>,
    );

    expect(screen.getByTestId("endorse-modal").getAttribute("data-open")).toBe("false");

    await act(async () => {
      screen.getByText("open").click();
    });

    expect(screen.getByTestId("endorse-modal").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("person-hash").textContent).toBe("0xperson");
    expect(screen.getByTestId("version-index").textContent).toBe("2");
    expect(screen.getByTestId("full-name").textContent).toBe("Ada Lovelace");
    expect(screen.getByTestId("endorsement-count").textContent).toBe("7");

    await act(async () => {
      screen.getByText("success").click();
    });

    expect(mocks.bumpEndorsementCount).toHaveBeenCalledWith("0xperson", 2, 1);
  });

  it("closes the modal through the provided close handler", async () => {
    render(
      <EndorseModalProvider>
        <Harness />
      </EndorseModalProvider>,
    );

    await act(async () => {
      screen.getByText("open").click();
    });
    expect(screen.getByTestId("endorse-modal").getAttribute("data-open")).toBe("true");

    await act(async () => {
      screen.getByText("close").click();
    });

    expect(screen.getByTestId("endorse-modal").getAttribute("data-open")).toBe("false");
    expect(screen.getByTestId("person-hash").textContent).toBe("");
    expect(screen.getByTestId("version-index").textContent).toBe("1");
  });
});
