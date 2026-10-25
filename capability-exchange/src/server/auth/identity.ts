import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/config/env";
import { hashPassword, verifyPassword } from "@/server/crypto";

/**
 * Where credentials are checked. Sessions, roles and permissions are always handled by
 * this application, whichever provider verifies the password.
 */
export interface IdentityProvider {
  readonly name: "password" | "supabase";
  register(input: { email: string; password: string }): Promise<{ passwordHash: string | null; externalId: string | null; needsEmailConfirmation: boolean }>;
  verify(input: { email: string; password: string; passwordHash: string | null }): Promise<{ ok: boolean; externalId?: string | null }>;
}

export const passwordIdentity: IdentityProvider = {
  name: "password",
  async register({ password }) {
    return { passwordHash: await hashPassword(password), externalId: null, needsEmailConfirmation: false };
  },
  async verify({ password, passwordHash }) {
    return { ok: await verifyPassword(password, passwordHash) };
  },
};

/**
 * Supabase Auth adapter: Supabase stores and checks the password (and sends its own
 * confirmation emails, if enabled in the Supabase project). Implemented against the
 * documented supabase-js API but not exercised against a live project in this repository.
 */
export function supabaseIdentity(): IdentityProvider {
  const env = getEnv();
  const client = () =>
    createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    name: "supabase",
    async register({ email, password }) {
      const { data, error } = await client().auth.signUp({ email, password, options: { emailRedirectTo: `${env.APP_URL}/sign-in` } });
      if (error || !data.user) throw new Error("Supabase sign-up failed");
      return { passwordHash: null, externalId: data.user.id, needsEmailConfirmation: !data.session };
    },
    async verify({ email, password }) {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error || !data.user) return { ok: false };
      return { ok: true, externalId: data.user.id };
    },
  };
}

export function getIdentityProvider(): IdentityProvider {
  return getEnv().AUTH_PROVIDER === "supabase" ? supabaseIdentity() : passwordIdentity;
}
