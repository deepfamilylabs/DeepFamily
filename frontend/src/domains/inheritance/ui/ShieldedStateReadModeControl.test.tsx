// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShieldedStateReadModeControl } from "./ShieldedStateReadModeControl";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

describe("ShieldedStateReadModeControl", () => {
  it("shows both choices and their privacy and performance explanations before selection", () => {
    const onChange = vi.fn();
    render(<ShieldedStateReadModeControl value="rebuild" disabled={false} onChange={onChange} />);
    expect((screen.getByRole("radio", { name: "shielded.stateReadMode.rebuild" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "shielded.stateReadMode.chain" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("shielded.stateReadMode.rebuildDescription")).toBeTruthy();
    expect(screen.getByText("shielded.stateReadMode.chainDescription")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "shielded.stateReadMode.chain" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("chain");
  });

  it("disables both modes while work or a submission is pending", () => {
    const onChange = vi.fn();
    render(<ShieldedStateReadModeControl value="chain" disabled onChange={onChange} />);
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLInputElement).disabled).toBe(true);
      fireEvent.click(radio);
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});
