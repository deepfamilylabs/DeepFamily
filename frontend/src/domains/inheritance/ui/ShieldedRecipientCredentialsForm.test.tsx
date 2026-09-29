// @vitest-environment jsdom
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ShieldedRecipientCredentialsForm,
  type ShieldedRecipientCredentialsFormHandle,
} from "./ShieldedRecipientCredentialsForm";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ShieldedRecipientCredentialsForm", () => {
  it("reads every identity field and clears the passphrase immediately", () => {
    const ref = createRef<ShieldedRecipientCredentialsFormHandle>();
    render(<ShieldedRecipientCredentialsForm ref={ref} />);

    fireEvent.change(screen.getByLabelText("search.hashCalculator.name"), {
      target: { value: "张三" },
    });
    fireEvent.change(screen.getByLabelText("search.hashCalculator.gender"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("search.hashCalculator.isBirthBC"), {
      target: { value: "bc" },
    });
    fireEvent.change(screen.getByLabelText("search.hashCalculator.birthYearLabel"), {
      target: { value: "35" },
    });
    fireEvent.change(screen.getByLabelText("search.hashCalculator.birthMonthLabel"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("search.hashCalculator.birthDayLabel"), {
      target: { value: "14" },
    });
    const password = screen.getByLabelText("search.hashCalculator.passphrase") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "child identity secret" } });

    expect(ref.current?.readAndClear()).toEqual({
      identity: {
        fullName: "张三",
        gender: 1,
        isBirthBC: true,
        birthYear: 35,
        birthMonth: 2,
        birthDay: 14,
      },
      rawPassphrase: "child identity secret",
    });
    expect(password.value).toBe("");

    fireEvent.change(password, { target: { value: "another secret" } });
    ref.current?.clearSecretInputs();
    expect(password.value).toBe("");
    expect((screen.getByLabelText("search.hashCalculator.name") as HTMLInputElement).value).toBe(
      "张三",
    );
  });
});
