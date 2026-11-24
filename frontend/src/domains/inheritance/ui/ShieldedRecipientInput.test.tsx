// @vitest-environment jsdom
import { createRef, type ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShieldedIdentityMatch } from "../../../shared/workers/shieldedAssetWorkerTypes";
import type { ShieldedRecipientCredentialsFormHandle } from "./ShieldedRecipientCredentialsForm";
import { ShieldedRecipientInput } from "./ShieldedWalletActions";

const suites = vi.hoisted(() => ({ supported: null as number[] | null }));

vi.mock("@deepfamily/protocol-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@deepfamily/protocol-core")>();
  return {
    ...actual,
    get DEFAULT_IDENTITY_SUITE_ID() {
      return suites.supported?.[0] ?? actual.DEFAULT_IDENTITY_SUITE_ID;
    },
    get SUPPORTED_IDENTITY_SUITE_IDS() {
      return suites.supported ?? actual.SUPPORTED_IDENTITY_SUITE_IDS;
    },
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "shielded.identitySuiteOption" && options ? `Suite ${options.suite}` : key,
    i18n: { language: "en" },
  }),
}));
// The real form is covered by its own tests; this one reports edits like it does.
vi.mock("./ShieldedRecipientCredentialsForm", async () => {
  const React = await import("react");
  return {
    ShieldedRecipientCredentialsForm: React.forwardRef<unknown, { onChange?: () => void }>(
      (props, _ref) => <input aria-label="recipient name" onChange={() => props.onChange?.()} />,
    ),
  };
});

const registered: ShieldedIdentityMatch = {
  identitySuiteId: 1, personHash: "0x" + "12".repeat(32), history: "registered",
};
const used: ShieldedIdentityMatch = {
  identitySuiteId: 2, personHash: "0x" + "34".repeat(32), history: "used",
};
const choice = (match: ShieldedIdentityMatch) =>
  `Suite ${match.identitySuiteId} · shielded.identityHistory.${match.history} ${match.personHash}`;

afterEach(() => {
  cleanup();
  suites.supported = null;
});

function renderInput(overrides: Partial<ComponentProps<typeof ShieldedRecipientInput>> = {}) {
  const props = {
    method: "credentials" as const,
    onMethodChange: vi.fn(),
    code: "",
    onCodeChange: vi.fn(),
    credentialsFormRef: createRef<ShieldedRecipientCredentialsFormHandle>(),
    findRecipientIdentities: vi.fn(async (): Promise<ShieldedIdentityMatch[] | undefined> => []),
    onGenerateCode: vi.fn(),
    busy: false,
    ...overrides,
  };
  render(<ShieldedRecipientInput {...props} />);
  return props;
}

async function generate() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "shielded.generateReceiveCode" }));
  });
}

function chooseManually(suite: string) {
  fireEvent.click(screen.getByText("shielded.manualRecipientSuite"));
  fireEvent.change(screen.getByRole("combobox", { name: "shielded.recipientIdentitySuite" }), {
    target: { value: suite },
  });
}

describe("recipient credentials with several identity suites", () => {
  it("generates for the only identity the recipient's credentials already use", async () => {
    suites.supported = [2, 1];
    const props = renderInput({ findRecipientIdentities: vi.fn(async () => [registered]) });
    await generate();
    expect(props.onGenerateCode).toHaveBeenCalledWith(1, registered.personHash);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the default suite when the recipient's credentials have no history", async () => {
    suites.supported = [2, 1];
    const props = renderInput();
    await generate();
    expect(props.findRecipientIdentities).toHaveBeenCalledTimes(1);
    expect(props.onGenerateCode).toHaveBeenCalledWith(2);
  });

  it("asks which identity to use when several have history and says why each is offered", async () => {
    suites.supported = [2, 1];
    const props = renderInput({ findRecipientIdentities: vi.fn(async () => [used, registered]) });
    await generate();
    const dialog = screen.getByRole("dialog", { name: "shielded.recipientIdentities" });
    expect(within(dialog).getByRole("button", { name: choice(used) })).toBeTruthy();
    expect(props.onGenerateCode).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: choice(registered) }));
    expect(props.onGenerateCode).toHaveBeenCalledWith(1, registered.personHash);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a manually chosen suite without a lookup", async () => {
    suites.supported = [2, 1];
    const props = renderInput();
    chooseManually("1");
    await generate();
    expect(props.findRecipientIdentities).not.toHaveBeenCalled();
    expect(props.onGenerateCode).toHaveBeenCalledWith(1);
  });

  it("generates nothing after a failed lookup and then accepts a manual suite", async () => {
    suites.supported = [2, 1];
    const props = renderInput({ findRecipientIdentities: vi.fn(async () => undefined) });
    await generate();
    expect(props.onGenerateCode).not.toHaveBeenCalled();
    chooseManually("1");
    await generate();
    expect(props.findRecipientIdentities).toHaveBeenCalledTimes(1);
    expect(props.onGenerateCode).toHaveBeenCalledWith(1);
  });

  it("discards a lookup made stale by editing the credentials", async () => {
    suites.supported = [2, 1];
    let finish!: (matches: ShieldedIdentityMatch[]) => void;
    const props = renderInput({
      findRecipientIdentities: vi.fn(() => new Promise<ShieldedIdentityMatch[]>((resolve) => { finish = resolve; })),
    });
    await generate();
    fireEvent.change(screen.getByLabelText("recipient name"), { target: { value: "Someone else" } });
    await act(async () => finish([used, registered]));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onGenerateCode).not.toHaveBeenCalled();
  });
});

describe("recipient credentials whose suite is already known", () => {
  it("uses a registered recipient's suite without a lookup or a manual choice", async () => {
    suites.supported = [2, 1];
    const props = renderInput({ recipientSuiteId: 1 });
    expect(screen.queryByText("shielded.manualRecipientSuite")).toBeNull();
    await generate();
    expect(props.findRecipientIdentities).not.toHaveBeenCalled();
    expect(props.onGenerateCode).toHaveBeenCalledWith(1);
  });

  it("uses the only supported suite without a lookup or a manual choice", async () => {
    const props = renderInput();
    expect(screen.queryByText("shielded.manualRecipientSuite")).toBeNull();
    await generate();
    expect(props.findRecipientIdentities).not.toHaveBeenCalled();
    expect(props.onGenerateCode).toHaveBeenCalledWith(1);
  });
});
