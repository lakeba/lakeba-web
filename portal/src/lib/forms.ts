/** Reads a trimmed string field from a submitted form. */
export const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

/** The Turnstile token, when the widget is on the page. */
export const captchaToken = (form: FormData) => field(form, 'cf-turnstile-response') || undefined;

/** Supabase password rules, mirrored for a friendlier message before submitting. */
export function passwordProblem(password: string) {
  if (password.length < 12) return 'Use at least 12 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return 'Use upper- and lower-case letters and at least one number.';
  }
  return null;
}
