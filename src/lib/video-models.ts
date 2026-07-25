export const OMNI_FLASH_MODEL = "gemini-omni-flash-preview";
export const VEO_FAST_MODEL = "veo-3.1-fast-generate-preview";
export const VEO_QUALITY_MODEL = "veo-3.1-generate-preview";
export const KLING_V3_STD_MODEL = "kling-v3-std";
export const KLING_V3_PRO_MODEL = "kling-v3-pro";
export const KLING_V3_TURBO_MODEL = "kling-3.0-turbo";

export type VideoModelChoice =
  | "auto"
  | typeof OMNI_FLASH_MODEL
  | typeof VEO_FAST_MODEL
  | typeof VEO_QUALITY_MODEL
  | typeof KLING_V3_STD_MODEL
  | typeof KLING_V3_PRO_MODEL
  | typeof KLING_V3_TURBO_MODEL;

export function isKlingModel(model: string): boolean {
  return (
    model === KLING_V3_STD_MODEL ||
    model === KLING_V3_PRO_MODEL ||
    model === KLING_V3_TURBO_MODEL
  );
}

export type VideoModelOption = {
  id: VideoModelChoice;
  label: string;
  shortLabel: string;
  description: string;
};

export const VIDEO_MODEL_OPTIONS: VideoModelOption[] = [
  {
    id: "auto",
    label: "Auto",
    shortLabel: "Auto",
    description:
      "Best fit for your input — Veo for character photos, Omni Flash for text-only.",
  },
  {
    id: VEO_FAST_MODEL,
    label: "Veo 3.1 Fast",
    shortLabel: "Fast",
    description: "Fastest Veo option. Good for quick iterations with character photos.",
  },
  {
    id: VEO_QUALITY_MODEL,
    label: "Veo 3.1 Quality",
    shortLabel: "Quality",
    description: "Higher-quality Veo output. Slower, best for final hooks.",
  },
  {
    id: OMNI_FLASH_MODEL,
    label: "Omni Flash",
    shortLabel: "Omni",
    description: "Fast text-to-video. Character photos fall back to Veo automatically.",
  },
  {
    id: KLING_V3_STD_MODEL,
    label: "Kling 3.0 Std",
    shortLabel: "Kling Std",
    description: "Kling 3.0 at 720p. Great for character photos with direct base64 upload.",
  },
  {
    id: KLING_V3_PRO_MODEL,
    label: "Kling 3.0 Pro",
    shortLabel: "Kling Pro",
    description: "Higher-quality Kling 3.0 at 1080p. Slower, best for final hooks.",
  },
  {
    id: KLING_V3_TURBO_MODEL,
    label: "Kling 3.0 Turbo",
    shortLabel: "Turbo",
    description:
      "Fastest Kling 3.0 route. Character photos need a public HTTPS tunnel (INSTAGRAM_MEDIA_BASE_URL).",
  },
];

const STORAGE_KEY = "hookr-video-model";

export const DEFAULT_VIDEO_MODEL_CHOICE: VideoModelChoice = "auto";

const ALLOWED_MODELS = new Set<string>(
  VIDEO_MODEL_OPTIONS.map((option) => option.id),
);

export function isVideoModelChoice(value: string): value is VideoModelChoice {
  return ALLOWED_MODELS.has(value);
}

export function loadVideoModelChoice(): VideoModelChoice {
  if (typeof window === "undefined") return DEFAULT_VIDEO_MODEL_CHOICE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw || !isVideoModelChoice(raw)) return DEFAULT_VIDEO_MODEL_CHOICE;
    return raw;
  } catch {
    return DEFAULT_VIDEO_MODEL_CHOICE;
  }
}

export function saveVideoModelChoice(choice: VideoModelChoice) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, choice);
}

export function getVideoModelOption(
  choice: VideoModelChoice,
): VideoModelOption {
  return (
    VIDEO_MODEL_OPTIONS.find((option) => option.id === choice) ??
    VIDEO_MODEL_OPTIONS[0]!
  );
}

export function resolveClientVideoModel(
  choice: VideoModelChoice,
): string | undefined {
  if (choice === "auto") return undefined;
  return choice;
}

export function parseVideoModelRequest(
  requested?: string | null,
): string | undefined {
  if (!requested?.trim() || requested === "auto") return undefined;
  if (!isVideoModelChoice(requested)) return undefined;
  if (requested === "auto") return undefined;
  return requested;
}

export function generatingLabel(choice: VideoModelChoice): string {
  switch (choice) {
    case VEO_QUALITY_MODEL:
      return "Generating with Veo Quality… (2–4 min)";
    case VEO_FAST_MODEL:
      return "Generating with Veo Fast… (1–3 min)";
    case OMNI_FLASH_MODEL:
      return "Generating with Omni Flash… (1–3 min)";
    case KLING_V3_PRO_MODEL:
      return "Generating with Kling 3.0 Pro… (2–4 min)";
    case KLING_V3_TURBO_MODEL:
      return "Generating with Kling 3.0 Turbo… (1–3 min)";
    case KLING_V3_STD_MODEL:
      return "Generating with Kling 3.0… (2–4 min)";
    default:
      return "Generating hook… (1–3 min)";
  }
}
