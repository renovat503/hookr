import path from "path";
import { mkdir } from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

export async function streamRequestBodyToFile(
  request: Request,
  destPath: string,
): Promise<number> {
  if (!request.body) {
    throw new Error("Empty upload body.");
  }

  await mkdir(path.dirname(destPath), { recursive: true });

  const source = Readable.fromWeb(
    request.body as import("stream/web").ReadableStream,
  );
  await pipeline(source, createWriteStream(destPath));

  const contentLength = Number(request.headers.get("content-length") || "0");
  return Number.isFinite(contentLength) ? contentLength : 0;
}
