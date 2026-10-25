/** What every server action returns to the form that called it. */
export interface ActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Optional data for the caller, e.g. a newly created share link. */
  data?: Record<string, string>;
}
