/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    supabase: import('@supabase/supabase-js').SupabaseClient;
    user: { id: string; email: string; aal: 'aal1' | 'aal2' } | null;
    profile: {
      email: string;
      first_name: string;
      last_name: string;
      role: 'investor' | 'board' | 'admin';
    } | null;
    /** Whether the user has a verified MFA factor. */
    mfaEnrolled: boolean;
  }
}
