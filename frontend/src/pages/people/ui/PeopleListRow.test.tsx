// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeData } from "../../../shared/model";
import { PeopleListRow } from "./PeopleListRow";

vi.mock("../../../domains/person", () => ({
  EndorseCompactModal: ({ isOpen, personHash }: { isOpen: boolean; personHash: string }) =>
    isOpen ? (
      <div role="dialog" aria-label="endorse">
        {personHash}
      </div>
    ) : null,
}));

const t = ((
  key: string,
  fallback?: string | Record<string, unknown>,
  values?: Record<string, unknown>,
) => {
  const options = typeof fallback === "object" ? fallback : values;
  const base = typeof fallback === "string" ? fallback : key;
  return base.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? ""));
}) as any;

const person = (overrides: Partial<NodeData> = {}) =>
  ({
    id: "p-21",
    personHash: `0x${"1".repeat(64)}`,
    versionIndex: 1,
    fullName: "曹操",
    tokenId: "21",
    endorsementCount: 1,
    storyRecords: [],
    storyMetadata: {
      totalRecords: 3,
      totalPayloadLength: 10,
      isSealed: false,
      lastUpdateTime: 1,
      recordsHead: "0x",
    },
    ...overrides,
  }) as unknown as NodeData;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PeopleListRow actions", () => {
  it("opens the encyclopedia in a new tab without also opening the row", () => {
    const onOpen = vi.fn();
    const preload = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <PeopleListRow t={t} person={person()} isFirst onOpen={onOpen} preloadStoryData={preload} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View Encyclopedia" }));

    expect(open).toHaveBeenCalledWith("/person/21", "_blank", "noopener,noreferrer");
    expect(preload).toHaveBeenCalledWith("21");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the endorse modal from the endorsement count without also opening the row", () => {
    const onOpen = vi.fn();
    render(<PeopleListRow t={t} person={person()} isFirst onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Click to endorse this version" }));

    expect(screen.getByRole("dialog", { name: "endorse" })).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps clicks made inside the endorse modal from reopening the row", () => {
    const onOpen = vi.fn();
    render(<PeopleListRow t={t} person={person()} isFirst onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Click to endorse this version" }));
    fireEvent.click(screen.getByRole("dialog", { name: "endorse" }));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("still opens the person when the row itself is clicked", () => {
    const onOpen = vi.fn();
    const subject = person();
    render(<PeopleListRow t={t} person={subject} isFirst onOpen={onOpen} />);

    fireEvent.click(screen.getByText("曹操"));

    expect(onOpen).toHaveBeenCalledWith(subject);
  });

  it("offers no encyclopedia or endorse action when there is nothing to open", () => {
    render(
      <PeopleListRow
        t={t}
        person={person({
          endorsementCount: 0,
          storyMetadata: {
            totalRecords: 0,
            totalPayloadLength: 0,
            isSealed: false,
            lastUpdateTime: 0,
            recordsHead: "0x",
          },
        } as Partial<NodeData>)}
        isFirst
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "View Encyclopedia" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Click to endorse this version" })).toBeNull();
  });
});
