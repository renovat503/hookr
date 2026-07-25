import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase media storage.",
    );
  }

  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export function getStorageBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "media";
}

export function getPublicMediaBaseUrl(): string {
  const explicit = process.env.SUPABASE_PUBLIC_MEDIA_BASE?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const url = process.env.SUPABASE_URL?.trim();
  const bucket = getStorageBucket();
  if (!url) {
    throw new Error("SUPABASE_URL is required for public media URLs.");
  }
  return `${url.replace(/\/$/, "")}/storage/v1/object/public/${bucket}`;
}

export function toPublicMediaUrl(storageKey: string): string {
  const key = storageKey.replace(/^\/+/, "");
  return `${getPublicMediaBaseUrl()}/${key}`;
}

export function isSupabaseMediaUrl(url: string): boolean {
  const base = process.env.SUPABASE_PUBLIC_MEDIA_BASE?.trim();
  if (base && url.startsWith(base.replace(/\/$/, ""))) return true;
  const supabaseUrl = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  if (!supabaseUrl) return false;
  return url.startsWith(`${supabaseUrl}/storage/v1/object/public/`);
}

export function storageKeyFromUrl(url: string): string | null {
  const publicBase = getPublicMediaBaseUrl();
  if (url.startsWith(`${publicBase}/`)) {
    return url.slice(publicBase.length + 1);
  }
  if (url.startsWith("/")) {
    return url.replace(/^\/+/, "");
  }
  return null;
}
