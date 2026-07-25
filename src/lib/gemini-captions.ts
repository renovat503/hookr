import { getGeminiClient, resolveTextModel } from "@/lib/gemini";
import { readCaptions, addCaptions } from "@/lib/caption-store";

export async function generateCaptionsFromLibrary(options: {
  count: number;
  theme?: string;
  saveToLibrary?: boolean;
}): Promise<{ captions: string[]; saved: number }> {
  const count = Math.min(50, Math.max(1, Math.round(options.count)));
  const library = await readCaptions();
  const examples = library.slice(0, 40).map((c) => c.text);

  if (examples.length < 3) {
    throw new Error(
      "Add at least 3 captions to your library before using AI expansion.",
    );
  }

  const ai = getGeminiClient();
  const model = resolveTextModel();

  const themeLine = options.theme?.trim()
    ? `Theme or niche: ${options.theme.trim()}`
    : "Match the general niche implied by the examples.";

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "You write short viral hook captions for vertical short-form videos (TikTok/Reels).",
              themeLine,
              "",
              "Study these example captions from the creator's library:",
              ...examples.map((t, i) => `${i + 1}. ${t}`),
              "",
              `Write exactly ${count} NEW captions that match the same tone, length, structure, and energy.`,
              "Rules:",
              "- Do NOT copy or lightly rephrase the examples.",
              "- One caption per line.",
              "- No numbering, bullets, or quotes.",
              "- Keep each caption under 120 characters.",
              "- Output ONLY the caption lines, nothing else.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const raw = response.text?.trim() ?? "";
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\d+[\).\s-]+/, "").trim())
    .map((line) => line.replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  const unique = [...new Set(lines)].slice(0, count);
  if (!unique.length) {
    throw new Error("AI did not return usable captions. Try again.");
  }

  let saved = 0;
  if (options.saveToLibrary) {
    const added = await addCaptions(unique);
    saved = added.length;
  }

  return { captions: unique, saved };
}

/** Short hook-line suggestions for Create (works with or without a caption library). */
export async function suggestHookCaptions(options: {
  count: number;
  theme?: string;
}): Promise<string[]> {
  const count = Math.min(8, Math.max(1, Math.round(options.count)));
  const library = await readCaptions();
  const examples = library.slice(0, 15).map((c) => c.text);

  const ai = getGeminiClient();
  const model = resolveTextModel();

  const themeLine = options.theme?.trim()
    ? `Topic or niche: ${options.theme.trim()}`
    : "Topic: viral short-form hook for a 4-second vertical video.";

  const exampleBlock =
    examples.length > 0
      ? [
          "Match the tone and energy of these existing captions from the creator:",
          ...examples.map((t, i) => `${i + 1}. ${t}`),
          "",
        ].join("\n")
      : "";

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "You write short viral hook captions burned onto 4-second vertical videos (TikTok/Reels).",
              themeLine,
              "",
              exampleBlock,
              `Write exactly ${count} NEW hook captions.`,
              "Rules:",
              "- One caption per line.",
              "- No numbering, bullets, or quotes.",
              "- Under 100 characters each.",
              "- Punchy, scroll-stopping, first-person or direct address when it fits.",
              "- May include 0–2 emojis if natural.",
              "- Output ONLY the caption lines, nothing else.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
    ],
  });

  const raw = response.text?.trim() ?? "";
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\d+[\).\s-]+/, "").trim())
    .map((line) => line.replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  const unique = [...new Set(lines)].slice(0, count);
  if (!unique.length) {
    throw new Error("AI did not return usable captions. Try again.");
  }

  return unique;
}
