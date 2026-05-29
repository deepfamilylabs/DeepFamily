// @vitest-environment jsdom
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizedRootSync } from "./LocalizedRootSync";

const mocks = vi.hoisted(() => ({
  language: "en",
  config: {
    rootHash: "0x" + "e".repeat(64),
    rootVersionIndex: 1,
    defaults: {
      rootHash: "0x" + "e".repeat(64),
      rootVersionIndex: 1,
    },
    update: vi.fn(),
  },
  localizedRoots: {
    EN: "0x" + "e".repeat(64),
    ZH: "0x" + "f".repeat(64),
  } as Record<string, string>,
  localizedVersions: {
    EN: 1,
    ZH: 2,
  } as Record<string, number>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: mocks.language },
  }),
}));

vi.mock("./ConfigContext", () => ({
  useConfig: () => mocks.config,
}));

vi.mock("../../../shared/config/env", () => ({
  getLocalizedRootHash: (suffix: string) => mocks.localizedRoots[suffix] || "",
  getLocalizedRootVersionIndex: (suffix: string) => mocks.localizedVersions[suffix] ?? NaN,
}));

describe("LocalizedRootSync", () => {
  beforeEach(() => {
    mocks.language = "en";
    mocks.config.rootHash = mocks.localizedRoots.EN;
    mocks.config.rootVersionIndex = 1;
    mocks.config.defaults.rootHash = mocks.localizedRoots.EN;
    mocks.config.defaults.rootVersionIndex = 1;
    mocks.config.update.mockReset();
  });

  it("switches from the English seed root to the Chinese seed root when language changes", async () => {
    mocks.language = "zh-CN";

    render(<LocalizedRootSync />);

    await waitFor(() =>
      expect(mocks.config.update).toHaveBeenCalledWith({
        rootHash: mocks.localizedRoots.ZH,
        rootVersionIndex: 2,
      }),
    );
  });

  it("does not overwrite a manually configured root", async () => {
    mocks.language = "zh-CN";
    mocks.config.rootHash = "0x" + "a".repeat(64);

    render(<LocalizedRootSync />);

    expect(mocks.config.update).not.toHaveBeenCalled();
  });
});
