import type { MintNftFlowAction, MintNftFlowState } from "./mintNftTypes";

export const initialMintNftFlowState: MintNftFlowState = { step: "idle" };

export function mintNftReducer(
  _state: MintNftFlowState,
  action: MintNftFlowAction,
): MintNftFlowState {
  switch (action.type) {
    case "reset":
      return initialMintNftFlowState;
    case "stage":
      return { step: action.step };
    case "success":
      return { step: "success", result: action.result };
    case "error":
      return { step: "error", error: action.error };
    default:
      return initialMintNftFlowState;
  }
}
