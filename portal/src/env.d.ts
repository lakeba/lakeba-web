/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    supabase: import('@supabase/supabase-js').SupabaseClient;
    /**
     * aal: 'aal2' once this session passed two-step verification or a verified
     * passkey sign-in (strongBy says which); codeVerified: the authenticator
     * code was entered, which Supabase still requires to change two-step or
     * passkey settings.
     */
    user: { id: string; email: string; aal: 'aal1' | 'aal2'; strongBy: 'code' | 'passkey' | null; codeVerified: boolean } | null;
    profile: {
      email: string;
      first_name: string;
      last_name: string;
      role: 'investor' | 'board' | 'admin';
      locale: import('./lib/i18n').Locale | null;
    } | null;
    /** Whether the user has a verified MFA factor. */
    mfaEnrolled: boolean;
    /** Companies this person belongs to and the one being viewed (signed-in pages). */
    companies: import('./lib/companies').Company[];
    company: import('./lib/companies').Company | null;
    group: import('./lib/companies').Company | null;
    /** Companies this person administers as a company admin. */
    adminOf: string[];
    /** Per-person switches set by admins (Admin → Investors). */
    features: { ask: boolean; boardQa: boolean; trading: boolean };
    /** Interface language, its translate function and date/number formats. */
    locale: import('./lib/i18n').Locale;
    t: import('./lib/i18n').T;
    fmt: ReturnType<typeof import('./lib/format').formats>;
  }
}
