import { safeUploadFilename } from "./utils";

/** Upload a demo clip without multipart FormData (avoids Next.js parse failures). */
export function uploadDemoClip(file: File, durationSeconds: number): Promise<Response> {
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
