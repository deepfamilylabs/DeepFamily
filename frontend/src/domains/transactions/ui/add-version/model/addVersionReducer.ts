import type { AddVersionFlowAction, AddVersionFlowState } from "./addVersionTypes";

export const initialAddVersionFlowState: AddVersionFlowState = { step: "idle" };

export function addVersionReducer(
  _state: AddVersionFlowState,
  action: AddVersionFlowAction,
): AddVersionFlowState {
  switch (action.type) {
    case "reset":
      return initialAddVersionFlowState;
    case "stage":
      return { step: action.step };
    case "success":
      return { step: "success", result: action.result };
    case "error":
      return { step: "error", error: action.error };
    default:
      return initialAddVersionFlowState;
  }
}
