/** What a `<form action>` server action hands back to `useActionState`. `values` refill the fields after an error. */
export type FormState = {
  ok: boolean;
  error?: string;
  message?: string;
  values?: Record<string, string | boolean>;
} | null;
