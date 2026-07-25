import {
  KLING_V3_PRO_MODEL,
  KLING_V3_STD_MODEL,
  KLING_V3_TURBO_MODEL,
} from "@/lib/video-models";

const DEFAULT_KLING_BASE = "https://api-singapore.klingai.com";
const HOOK_DURATION_SECONDS = 4;

type KlingTaskStatus =
  | "submitted"
  | "processing"
  | "succeed"
  | "succeeded"
  | "failed";

type KlingApiResponse<T> = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
};

type KlingCreateTaskData = {
  task_id?: string;
  id?: string;
  task_status?: string;
  status?: string;
};

type KlingTaskResult = {
  task_id?: string;
  task_status?: KlingTaskStatus;
  task_status_msg?: string;
  task_result?: {
    videos?: Array<{ id?: string; url?: string; duration?: string }>;
  };
};

export type KlingGenerationMode = "std" | "pro";

export function getKlingApiKey(): string {
  const apiKey = process.env.KLING_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "KLING_API_KEY is not set. Add it to .env.local from kling.ai/dev/api-key.",
    );
  }
  return apiKey;
}

export function getKlingApiBase(): string {
  const raw = process.env.KLING_API_BASE?.trim();
  if (!raw) return DEFAULT_KLING_BASE;
  return raw.replace(/#.*$/, "").trim().replace(/\/$/, "");
}

export function resolveKlingGeneration(model: string): {
  modelId: string;
  mode: KlingGenerationMode;
  label: string;
  turbo: boolean;
  resolution: "720p" | "1080p";
} {
  switch (model) {
    case KLING_V3_PRO_MODEL:
      return {
        modelId: "kling-v3",
        mode: "pro",
        label: "Kling 3.0 Pro",
        turbo: false,
        resolution: "1080p",
      };
    case KLING_V3_TURBO_MODEL:
      return {
        modelId: "kling-3.0-turbo",
        mode: "std",
        label: "Kling 3.0 Turbo",
        turbo: true,
        resolution: "720p",
      };
    case KLING_V3_STD_MODEL:
    default:
      return {
        modelId: "kling-v3",
        mode: "std",
        label: "Kling 3.0 Std",
        turbo: false,
        resolution: "720p",
      };
  }
}

function klingHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getKlingApiKey()}`,
    "Content-Type": "application/json",
  };
}

async function parseKlingResponse<T>(
  res: Response,
): Promise<KlingApiResponse<T>> {
  const json = (await res.json()) as KlingApiResponse<T>;
  if (!res.ok || (json.code != null && json.code !== 0)) {
    throw new Error(json.message || `Kling API error (${res.status})`);
  }
  return json;
}

function extractTaskId(data: KlingCreateTaskData | undefined): string {
  const taskId = data?.task_id?.trim() || data?.id?.trim();
  if (!taskId) {
    throw new Error("Kling returned no task ID.");
  }
  return taskId;
}

function isTaskComplete(status: string | undefined): boolean {
  return status === "succeed" || status === "succeeded";
}

function isTaskFailed(status: string | undefined): boolean {
  return status === "failed";
}

async function createLegacyImageToVideoTask(options: {
  prompt: string;
  imageBase64: string;
  mode: KlingGenerationMode;
}): Promise<string> {
  const res = await fetch(`${getKlingApiBase()}/v1/videos/image2video`, {
    method: "POST",
    headers: klingHeaders(),
    body: JSON.stringify({
      model_name: "kling-v3",
      image: options.imageBase64.trim(),
      prompt: options.prompt,
      negative_prompt: "",
      mode: options.mode,
      aspect_ratio: "9:16",
      duration: String(HOOK_DURATION_SECONDS),
      sound: "off",
    }),
  });

  const json = await parseKlingResponse<KlingCreateTaskData>(res);
  return extractTaskId(json.data);
}

async function createLegacyTextToVideoTask(options: {
  prompt: string;
  mode: KlingGenerationMode;
}): Promise<string> {
  const res = await fetch(`${getKlingApiBase()}/v1/videos/text2video`, {
    method: "POST",
    headers: klingHeaders(),
    body: JSON.stringify({
      model_name: "kling-v3",
      prompt: options.prompt,
      negative_prompt: "",
      mode: options.mode,
      aspect_ratio: "9:16",
      duration: String(HOOK_DURATION_SECONDS),
      sound: "off",
    }),
  });

  const json = await parseKlingResponse<KlingCreateTaskData>(res);
  return extractTaskId(json.data);
}

async function createTurboImageToVideoTask(options: {
  prompt: string;
  imageUrl: string;
  resolution: "720p" | "1080p";
}): Promise<string> {
  const res = await fetch(
    `${getKlingApiBase()}/image-to-video/kling-3.0-turbo`,
    {
      method: "POST",
      headers: klingHeaders(),
      body: JSON.stringify({
        contents: [
          { type: "prompt", text: options.prompt },
          { type: "first_frame", url: options.imageUrl },
        ],
        settings: {
          resolution: options.resolution,
          duration: HOOK_DURATION_SECONDS,
        },
        options: {
          watermark_info: { enabled: false },
        },
      }),
    },
  );

  const json = await parseKlingResponse<KlingCreateTaskData>(res);
  return extractTaskId(json.data);
}

async function createTurboTextToVideoTask(options: {
  prompt: string;
  resolution: "720p" | "1080p";
}): Promise<string> {
  const res = await fetch(
    `${getKlingApiBase()}/text-to-video/kling-3.0-turbo`,
    {
      method: "POST",
      headers: klingHeaders(),
      body: JSON.stringify({
        prompt: options.prompt,
        settings: {
          resolution: options.resolution,
          aspect_ratio: "9:16",
          duration: HOOK_DURATION_SECONDS,
        },
        options: {
          watermark_info: { enabled: false },
        },
      }),
    },
  );

  const json = await parseKlingResponse<KlingCreateTaskData>(res);
  return extractTaskId(json.data);
}

async function pollLegacyTask(
  kind: "image2video" | "text2video",
  taskId: string,
  {
    intervalMs = 8000,
    timeoutMs = 6 * 60 * 1000,
  }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<KlingTaskResult> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `${getKlingApiBase()}/v1/videos/${kind}/${taskId}`,
      {
        method: "GET",
        headers: klingHeaders(),
      },
    );
    const json = await parseKlingResponse<KlingTaskResult>(res);
    const data = json.data;
    const status = data?.task_status;

    if (isTaskComplete(status)) return data!;
    if (isTaskFailed(status)) {
      throw new Error(
        data?.task_status_msg?.trim() ||
          "Kling video generation failed. The prompt may have been blocked.",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Kling generation timed out. Try again in a moment.");
}

type TurboTaskData = {
  id?: string;
  status?: KlingTaskStatus;
  message?: string;
  outputs?: Array<{ type?: string; url?: string }>;
  task_result?: {
    videos?: Array<{ url?: string }>;
  };
  result?: {
    videos?: Array<{ url?: string }>;
  };
};

async function pollTurboTask(
  taskId: string,
  {
    intervalMs = 8000,
    timeoutMs = 6 * 60 * 1000,
  }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<TurboTaskData> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `${getKlingApiBase()}/tasks?task_ids=${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: klingHeaders(),
      },
    );
    const json = await parseKlingResponse<TurboTaskData[]>(res);
    const data = Array.isArray(json.data) ? json.data[0] : undefined;
    const status = data?.status;

    if (isTaskComplete(status)) return data!;
    if (isTaskFailed(status)) {
      throw new Error(
        data?.message?.trim() || "Kling Turbo generation failed.",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Kling Turbo generation timed out. Try again in a moment.");
}

function extractVideoUrl(data: KlingTaskResult | TurboTaskData): string {
  const legacyUrl = (data as KlingTaskResult).task_result?.videos?.[0]?.url;
  if (legacyUrl) return legacyUrl;

  const turboData = data as TurboTaskData;
  const turboUrl =
    turboData.outputs?.find((item) => item.type === "video")?.url ||
    turboData.task_result?.videos?.[0]?.url ||
    turboData.result?.videos?.[0]?.url;
  if (turboUrl) return turboUrl;

  throw new Error("Kling returned no video URL.");
}

async function downloadKlingVideo(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not download Kling video (${res.status}).`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function generateKlingHookVideo(options: {
  prompt: string;
  model: string;
  imageBase64?: string | null;
  imagePublicUrl?: string | null;
}): Promise<{
  videoBytes: Buffer;
  model: string;
  usedReferenceImage: boolean;
}> {
  const config = resolveKlingGeneration(options.model);
  const hasImage = Boolean(options.imageBase64?.trim());
  let taskId: string;
  let pollKind: "legacy-image" | "legacy-text" | "turbo" = "legacy-text";

  if (config.turbo) {
    pollKind = "turbo";
    if (hasImage) {
      const imageUrl = options.imagePublicUrl?.trim();
      if (!imageUrl) {
        throw new Error(
          "Kling 3.0 Turbo needs a public HTTPS image URL for character photos. Use Kling 3.0 Std/Pro, or set INSTAGRAM_MEDIA_BASE_URL to a public tunnel.",
        );
      }
      taskId = await createTurboImageToVideoTask({
        prompt: options.prompt,
        imageUrl,
        resolution: config.resolution,
      });
    } else {
      taskId = await createTurboTextToVideoTask({
        prompt: options.prompt,
        resolution: config.resolution,
      });
    }
  } else if (hasImage) {
    pollKind = "legacy-image";
    taskId = await createLegacyImageToVideoTask({
      prompt: options.prompt,
      imageBase64: options.imageBase64!.trim(),
      mode: config.mode,
    });
  } else {
    pollKind = "legacy-text";
    taskId = await createLegacyTextToVideoTask({
      prompt: options.prompt,
      mode: config.mode,
    });
  }

  let videoUrl: string;
  if (pollKind === "turbo") {
    const result = await pollTurboTask(taskId);
    videoUrl = extractVideoUrl(result);
  } else if (pollKind === "legacy-image") {
    const result = await pollLegacyTask("image2video", taskId);
    videoUrl = extractVideoUrl(result);
  } else {
    const result = await pollLegacyTask("text2video", taskId);
    videoUrl = extractVideoUrl(result);
  }

  const videoBytes = await downloadKlingVideo(videoUrl);
  return {
    videoBytes,
    model: config.label,
    usedReferenceImage: hasImage,
  };
}

export function formatKlingError(err: unknown): { message: string; status: number } {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unexpected Kling generation error.";

  if (/401|authentication|unauthorized|invalid.*key/i.test(raw)) {
    return {
      message:
        "Kling API authentication failed. Check KLING_API_KEY in .env.local.",
      status: 401,
    };
  }

  if (/402|insufficient|credit|balance|arrears/i.test(raw)) {
    return {
      message: "Kling account has insufficient credits. Top up at kling.ai/dev.",
      status: 402,
    };
  }

  if (/429|rate.?limit|concurrency/i.test(raw)) {
    return {
      message: "Kling rate limit exceeded. Wait a moment and try again.",
      status: 429,
    };
  }

  return { message: raw, status: 502 };
}
