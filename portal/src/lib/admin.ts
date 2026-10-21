import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SECRET_KEY, SUPABASE_URL } from 'astro:env/server';

/**
 * Service client that bypasses row-level security. Only call it from admin
 * pages, after the middleware has confirmed an MFA-verified admin session.
 */
export const serviceClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
