import type { EndorseFlowAction, EndorseFlowState } from "./endorseTypes";

export const initialEndorseFlowState: EndorseFlowState = { step: "idle" };

export function endorseReducer(
  _state: EndorseFlowState,
  action: EndorseFlowAction,
): EndorseFlowState {
  switch (action.type) {
    case "reset":
      return initialEndorseFlowState;
    case "stage":
      return { step: action.step };
    case "success":
      return { step: "success", result: action.result };
    case "error":
      return { step: "error", error: action.error };
    default:
      return initialEndorseFlowState;
  }
}
