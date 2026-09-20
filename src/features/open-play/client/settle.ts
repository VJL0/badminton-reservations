import type { FormState } from "../actions/form-state";
import type { ActionResult } from "../actions/result";

export const OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

/**
 * A Server Action rejects when the phone has no connection (nothing is held back and replayed later: a tap
 * either reaches the server now or says so). Left alone, a rejection inside a transition reaches the error
 * boundary and replaces the whole board, so every call from the browser goes through here and comes back as
 * the same { ok: false, error } a refusal from the database does.
 */
export async function settle(action: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await action();
  } catch {
    return { ok: false, error: OFFLINE_MESSAGE };
  }
}

/** The same for a `<form action>` handed to useActionState. */
export function settleForm(action: (prev: FormState, data: FormData) => Promise<FormState>) {
  return async (prev: FormState, data: FormData): Promise<FormState> => {
    try {
      return await action(prev, data);
    } catch {
      return { ok: false, error: OFFLINE_MESSAGE, values: prev?.values };
    }
  };
}
