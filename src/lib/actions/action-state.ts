/** Result of a Server Action, consumed with `useActionState`. */
export type ActionState =
  | { status: "idle" }
  | { status: "success" | "error"; message: string; /** Makes repeated identical results distinct. */ at: number };

export const IDLE_ACTION_STATE: ActionState = { status: "idle" };
