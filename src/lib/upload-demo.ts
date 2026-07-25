import { safeUploadFilename } from "./utils";

export const LARGE_DEMO_BYTES = 48 * 1024 * 1024;

function uploadFetchError(err: unknown): Error {
  if (err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(err.message)) {
    return new Error(
      "Upload lost connection or timed out. For large videos, use Wi‑Fi and keep this tab open, or trim the clip first.",
    );
  }
  return err instanceof Error ? err : new Error("Upload failed.");
}

async function uploadDirectToSupabase(
  file: File,
  durationSeconds: number,
): Promise<Response> {
  const filename = safeUploadFilename(file.name);
  const signRes = await fetch("/api/library/demos/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      durationSeconds,
      fileSize: file.size,
      contentType: file.type || "video/mp4",
    }),
  });

  const sign = (await signRes.json()) as {
    mode?: "direct" | "server";
    error?: string;
    id?: string;
    signedUrl?: string;
    storageKey?: string;
  };

  if (!signRes.ok) {
    return new Response(JSON.stringify({ error: sign.error || "Upload failed." }), {
      status: signRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (sign.mode !== "direct" || !sign.signedUrl || !sign.id || !sign.storageKey) {
    return uploadViaServer(file, durationSeconds);
  }

  const uploadRes = await fetch(sign.signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "video/mp4",
    },
    body: file,
  });

  if (!uploadRes.ok) {
    const message = `Storage upload failed (${uploadRes.status}).`;
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return fetch("/api/library/demos/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: sign.id,
      filename,
      durationSeconds,
      storageKey: sign.storageKey,
    }),
  });
}

async function uploadViaServer(
  file: File,
  durationSeconds: number,
): Promise<Response> {
  const params = new URLSearchParams({
    filename: safeUploadFilename(file.name),
    durationSeconds: String(durationSeconds),
  });

  return fetch(`/api/library/demos?${params}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "video/mp4",
    },
    body: file,
  });
}

/** Upload a demo clip, using direct Supabase storage when possible. */
export async function uploadDemoClip(
  file: File,
  durationSeconds: number,
): Promise<Response> {
  try {
    if (file.size <= LARGE_DEMO_BYTES) {
      return await uploadDirectToSupabase(file, durationSeconds);
    }
    return await uploadViaServer(file, durationSeconds);
  } catch (err) {
    throw uploadFetchError(err);
  }
}
