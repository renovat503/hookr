"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Highlighter,
  ImagePlus,
  Italic,
  Loader2,
  Minus,
  Play,
  Plus,
  Sparkles,
  Save,
  Trash2,
  Type,
  Upload,
  Video,
  Wand2,
  X,
} from "lucide-react";
import {
  ACTION_PROMPTS,
  ALIGN_OPTIONS,
  BORDER_COLOR_OPTIONS,
  BORDER_WIDTH_OPTIONS,
  CHARACTER_PRESETS,
  FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  LAYOUT_OPTIONS,
  OVERLAY_EMOJIS,
  TEXT_COLOR_OPTIONS,
} from "@/lib/constants";
import type {
  CharacterSource,
  HookConfig,
  LibraryCharacter,
  LibraryCaption,
  LibraryMotion,
  OverlayStyle,
} from "@/lib/types";
import {
  createFormatPreset,
  loadFormatPresets,
  saveFormatPresets,
  stylesMatch,
  type FormatPreset,
} from "@/lib/format-presets";
import { captureCaptionPng } from "@/lib/capture-caption";
import { ReelPlayer, reelFrameClass, reelVideoClass } from "@/components/ui/ReelPlayer";
import { hasCustomOverlayPosition } from "@/lib/overlay-position";
import { hookNeedsOverlayBurn, mergeOverlayStyle } from "@/lib/overlay-style";
import {
  generatingLabel,
  getVideoModelOption,
  isKlingModel,
  KLING_V3_TURBO_MODEL,
  loadVideoModelChoice,
  OMNI_FLASH_MODEL,
  saveVideoModelChoice,
  VIDEO_MODEL_OPTIONS,
  type VideoModelChoice,
} from "@/lib/video-models";
import { cn } from "@/lib/utils";
import {
  loadRecentCharacters,
  removeRecentCharacter,
  touchRecentCharacter,
  type RecentCharacterRef,
} from "@/lib/recent-characters";
import {
  loadRecentMotions,
  removeRecentMotion,
  touchRecentMotion,
  type RecentMotionRef,
} from "@/lib/recent-motions";
import {
  CAPTION_FRAME,
  captionTextStyle,
  overlayFontClass,
  overlayPaddingClass,
  overlayStyleClass,
} from "@/components/hook/CaptionOverlay";
import { DraggableCaptionOverlay } from "@/components/hook/DraggableCaptionOverlay";
import { HookCaptionTools } from "@/components/hook/HookCaptionTools";

type HookBuilderProps = {
  value: HookConfig;
  onChange: (next: HookConfig) => void;
  onContinue?: () => void;
};

export function HookBuilder({ value, onChange, onContinue }: HookBuilderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [libraryMotions, setLibraryMotions] = useState<LibraryMotion[]>([]);
  const [libraryCharacters, setLibraryCharacters] = useState<LibraryCharacter[]>(
    [],
  );
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [uploadingCharacter, setUploadingCharacter] = useState(false);
  const [formatPresets, setFormatPresets] = useState<FormatPreset[]>([]);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [referencePreviewId, setReferencePreviewId] = useState<string | null>(
    null,
  );
  const [videoModelChoice, setVideoModelChoice] = useState<VideoModelChoice>(
    "auto",
  );
  const [charactersExpanded, setCharactersExpanded] = useState(false);
  const [motionsExpanded, setMotionsExpanded] = useState(false);
  const [libraryMotionsExpanded, setLibraryMotionsExpanded] = useState(false);
  const [selectedLibraryCaptionId, setSelectedLibraryCaptionId] = useState<
    string | null
  >(null);
  const [libraryCaptions, setLibraryCaptions] = useState<LibraryCaption[]>([]);
  const [captionLibraryRefresh, setCaptionLibraryRefresh] = useState(0);
  const [savingCaption, setSavingCaption] = useState(false);
  const [captionSaveNotice, setCaptionSaveNotice] = useState<string | null>(
    null,
  );
  const selectingCaptionRef = useRef(false);
  const [recentCharacters, setRecentCharacters] = useState<RecentCharacterRef[]>(
    [],
  );
  const [recentMotions, setRecentMotions] = useState<RecentMotionRef[]>([]);
  const [referenceMotionId, setReferenceMotionId] = useState<string | null>(
    null,
  );
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(
    () => 240 / CAPTION_FRAME.width,
  );

  const RECENT_CHARACTERS_VISIBLE = 3;
  const RECENT_MOTIONS_VISIBLE = 3;
  const LIBRARY_MOTIONS_VISIBLE = 5;

  const isLibraryMode = value.characterSource === "library";
  const selectedVideoModel = getVideoModelOption(videoModelChoice);
  const usesCharacterPhoto =
    value.characterSource === "upload" && Boolean(value.uploadedImageUrl);

  useEffect(() => {
    setFormatPresets(loadFormatPresets());
    setVideoModelChoice(loadVideoModelChoice());
    setRecentCharacters(loadRecentCharacters());
    setRecentMotions(loadRecentMotions());
    void fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { referenceMotionId?: string | null } | null) => {
        if (data?.referenceMotionId) {
          setReferenceMotionId(data.referenceMotionId);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const el = previewFrameRef.current;
    if (!el) return;
    const update = () => {
      setPreviewScale(el.clientWidth / CAPTION_FRAME.width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const selectVideoModel = useCallback((choice: VideoModelChoice) => {
    setVideoModelChoice(choice);
    saveVideoModelChoice(choice);
  }, []);

  const patch = useCallback(
    (partial: Partial<HookConfig>) => onChange({ ...value, ...partial }),
    [onChange, value],
  );

  const patchStyle = useCallback(
    (partial: Partial<OverlayStyle>) =>
      onChange({ ...value, overlayStyle: { ...value.overlayStyle, ...partial } }),
    [onChange, value],
  );

  const persistReferenceMotion = useCallback(async (motionId: string | null) => {
    setReferenceMotionId(motionId);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referenceMotionId: motionId }),
    });
  }, []);

  const persistPresets = useCallback((next: FormatPreset[]) => {
    setFormatPresets(next);
    saveFormatPresets(next);
  }, []);

  const handleSavePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    const preset = createFormatPreset(name, value.overlayStyle);
    persistPresets([preset, ...formatPresets]);
    setPresetName("");
    setSavingPreset(false);
  }, [presetName, value.overlayStyle, formatPresets, persistPresets]);

  const handleDeletePreset = useCallback(
    (id: string) => {
      persistPresets(formatPresets.filter((p) => p.id !== id));
    },
    [formatPresets, persistPresets],
  );

  const appendOverlayEmoji = useCallback(
    (emoji: string) => {
      patch({ overlayText: `${value.overlayText}${emoji}` });
    },
    [patch, value.overlayText],
  );

  const handleCaptionSelect = useCallback(
    (text: string, captionId?: string | null) => {
      selectingCaptionRef.current = true;
      setSelectedLibraryCaptionId(captionId ?? null);
      setCaptionSaveNotice(null);
      patch({ overlayText: text });
    },
    [patch],
  );

  const trimmedOverlayText = value.overlayText.trim();
  const selectedLibraryCaption = selectedLibraryCaptionId
    ? libraryCaptions.find((caption) => caption.id === selectedLibraryCaptionId)
    : null;
  const matchingLibraryCaption = libraryCaptions.find(
    (caption) =>
      caption.text.trim().toLowerCase() === trimmedOverlayText.toLowerCase(),
  );
  const captionAlreadyInLibrary = Boolean(
    trimmedOverlayText &&
      (matchingLibraryCaption?.text.trim().toLowerCase() ===
        trimmedOverlayText.toLowerCase() ||
        selectedLibraryCaption?.text.trim().toLowerCase() ===
          trimmedOverlayText.toLowerCase()),
  );
  const canSaveCaptionToLibrary =
    Boolean(trimmedOverlayText) &&
    !captionAlreadyInLibrary &&
    !savingCaption;

  const saveCaptionToLibrary = useCallback(async () => {
    if (!trimmedOverlayText || savingCaption) return;

    setSavingCaption(true);
    setCaptionSaveNotice(null);

    try {
      if (selectedLibraryCaptionId) {
        const res = await fetch("/api/library/captions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: selectedLibraryCaptionId,
            text: trimmedOverlayText,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error || "Could not save caption.");
        setCaptionSaveNotice("Caption updated in library.");
      } else {
        const res = await fetch("/api/library/captions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: [trimmedOverlayText] }),
        });
        const json = (await res.json()) as {
          captions?: LibraryCaption[];
          added?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || "Could not save caption.");
        const added = json.captions?.[0];
        if (added) {
          setSelectedLibraryCaptionId(added.id);
          setCaptionSaveNotice("Caption saved to library.");
        } else {
          setCaptionSaveNotice("Caption is already in your library.");
        }
      }
      setCaptionLibraryRefresh((count) => count + 1);
    } catch (err) {
      setCaptionSaveNotice(
        err instanceof Error ? err.message : "Could not save caption.",
      );
    } finally {
      setSavingCaption(false);
    }
  }, [trimmedOverlayText, savingCaption, selectedLibraryCaptionId]);

  const handleOverlayPositionChange = useCallback(
    ({ x, y }: { x: number; y: number }) => {
      patchStyle({
        positionX: x,
        positionY: y,
      });
    },
    [patchStyle],
  );

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const libRes = await fetch("/api/library?scope=create");
      if (!libRes.ok) return;
      const data = (await libRes.json()) as {
        characters?: LibraryCharacter[];
        motions?: LibraryMotion[];
      };
      setLibraryCharacters(data.characters ?? []);
      setLibraryMotions(data.motions ?? []);
    } catch {
      // ignore — empty library UI handles this
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    if (!referenceMotionId || value.actionPrompt.trim()) return;
    const motion = libraryMotions.find((m) => m.id === referenceMotionId);
    if (motion?.actionPrompt) {
      patch({ actionPrompt: motion.actionPrompt });
    }
  }, [referenceMotionId, libraryMotions, value.actionPrompt, patch]);

  const clearGeneratedPreview = {
    generatedClipUrl: null as string | null,
    generatedRawClipUrl: null as string | null,
    generatedHookId: null as string | null,
    generatedMotionId: null as string | null,
    generatedOverlaySnapshot: null as HookConfig["generatedOverlaySnapshot"],
  };

  const setSource = (characterSource: CharacterSource) => {
    patch({
      characterSource,
      ...clearGeneratedPreview,
      generationError: null,
      ...(characterSource === "library"
        ? {
            characterPresetId: null,
            uploadedImageUrl: null,
            uploadedImageName: null,
            characterLibraryId: null,
          }
        : {
            libraryHookId: null,
          }),
    });
  };

  const selectCharacterPhoto = (options: {
    url: string;
    name: string;
    characterLibraryId?: string | null;
    characterPresetId?: string | null;
  }) => {
    if (options.characterLibraryId) {
      setRecentCharacters(
        touchRecentCharacter({
          type: "library",
          id: options.characterLibraryId,
        }),
      );
    } else if (options.characterPresetId) {
      setRecentCharacters(
        touchRecentCharacter({ type: "preset", id: options.characterPresetId }),
      );
    }
    patch({
      characterSource: "upload",
      uploadedImageUrl: options.url,
      uploadedImageName: options.name,
      characterLibraryId: options.characterLibraryId ?? null,
      characterPresetId: options.characterPresetId ?? null,
      libraryHookId: null,
      ...clearGeneratedPreview,
      generationError: null,
    });
  };

  const selectLibraryMotion = (motion: LibraryMotion) => {
    setRecentMotions(touchRecentMotion(motion.id));
    patch({
      characterSource: "library",
      libraryHookId: null,
      generatedMotionId: motion.id,
      generatedHookId: null,
      actionPrompt: motion.actionPrompt,
      overlayText: "",
      generatedClipUrl: motion.url,
      generatedRawClipUrl: motion.url,
      generatedOverlaySnapshot: null,
      generationError: null,
    });
  };

  const selectReferenceMotion = (motion: LibraryMotion | null) => {
    void persistReferenceMotion(motion?.id ?? null);
    if (!motion) {
      setReferencePreviewId(null);
      patch({ actionPrompt: "" });
      return;
    }
    setRecentMotions(touchRecentMotion(motion.id));
    patch({
      actionPrompt: motion.actionPrompt,
      generationError: null,
    });
    setReferencePreviewId(motion.id);
  };

  const deleteMotionClip = async (id: string, name: string) => {
    if (!window.confirm(`Delete “${name}” from your motion library?`)) return;

    try {
      const res = await fetch(
        `/api/library/motions?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not delete motion.");

      setLibraryMotions((current) => current.filter((m) => m.id !== id));
      setRecentMotions(removeRecentMotion(id));
      if (referenceMotionId === id) {
        void persistReferenceMotion(null);
        patch({ actionPrompt: "" });
        setReferencePreviewId(null);
      }
    } catch (err) {
      patch({
        generationError:
          err instanceof Error ? err.message : "Could not delete motion.",
      });
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;

    setUploadingCharacter(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name.replace(/\.[^/.]+$/, ""));

      const res = await fetch("/api/library/characters", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as LibraryCharacter & { error?: string };
      if (!res.ok) throw new Error(json.error || "Upload failed.");

      setLibraryCharacters((current) => [json, ...current]);
      setRecentCharacters(
        touchRecentCharacter({ type: "library", id: json.id }),
      );
      selectCharacterPhoto({
        url: json.url,
        name: json.name,
        characterLibraryId: json.id,
      });
    } catch (err) {
      patch({
        generationError:
          err instanceof Error ? err.message : "Could not upload character photo.",
      });
    } finally {
      setUploadingCharacter(false);
    }
  };

  const deleteCharacterPhoto = async (id: string, name: string) => {
    if (!window.confirm(`Delete “${name}” from your characters?`)) return;

    try {
      const res = await fetch(
        `/api/library/characters?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not delete character.");

      setLibraryCharacters((current) => current.filter((c) => c.id !== id));
      setRecentCharacters(
        removeRecentCharacter({ type: "library", id }),
      );
      if (value.characterLibraryId === id) {
        patch({
          uploadedImageUrl: null,
          uploadedImageName: null,
          characterLibraryId: null,
          characterPresetId: null,
        });
      }
    } catch (err) {
      patch({
        generationError:
          err instanceof Error ? err.message : "Could not delete character.",
      });
    }
  };

  const isCharacterSelected = (options: {
    presetId?: string;
    libraryId?: string;
  }) => {
    if (options.libraryId) {
      return value.characterLibraryId === options.libraryId;
    }
    if (options.presetId) {
      return (
        value.characterPresetId === options.presetId &&
        !value.characterLibraryId
      );
    }
    return false;
  };

  type CharacterGridItem =
    | { kind: "preset"; preset: (typeof CHARACTER_PRESETS)[number] }
    | { kind: "library"; character: LibraryCharacter };

  const recentCharacterItems = useMemo(() => {
    const items: CharacterGridItem[] = [];
    const seen = new Set<string>();

    const push = (item: CharacterGridItem) => {
      const key =
        item.kind === "preset"
          ? `preset:${item.preset.id}`
          : `library:${item.character.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    };

    for (const ref of recentCharacters) {
      if (items.length >= RECENT_CHARACTERS_VISIBLE) break;
      if (ref.type === "preset") {
        const preset = CHARACTER_PRESETS.find((p) => p.id === ref.id);
        if (preset) push({ kind: "preset", preset });
      } else {
        const character = libraryCharacters.find((c) => c.id === ref.id);
        if (character) push({ kind: "library", character });
      }
    }

    if (value.characterLibraryId) {
      const selected = libraryCharacters.find(
        (c) => c.id === value.characterLibraryId,
      );
      if (selected && !seen.has(`library:${selected.id}`)) {
        if (items.length >= RECENT_CHARACTERS_VISIBLE) items.pop();
        push({ kind: "library", character: selected });
      }
    } else if (value.characterPresetId) {
      const selected = CHARACTER_PRESETS.find(
        (p) => p.id === value.characterPresetId,
      );
      if (selected && !seen.has(`preset:${selected.id}`)) {
        if (items.length >= RECENT_CHARACTERS_VISIBLE) items.pop();
        push({ kind: "preset", preset: selected });
      }
    }

    for (const character of [...libraryCharacters].sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    )) {
      if (items.length >= RECENT_CHARACTERS_VISIBLE) break;
      push({ kind: "library", character });
    }

    for (const preset of CHARACTER_PRESETS) {
      if (items.length >= RECENT_CHARACTERS_VISIBLE) break;
      push({ kind: "preset", preset });
    }

    return items.slice(0, RECENT_CHARACTERS_VISIBLE);
  }, [
    recentCharacters,
    libraryCharacters,
    value.characterLibraryId,
    value.characterPresetId,
  ]);

  const totalCharacterCount =
    CHARACTER_PRESETS.length + libraryCharacters.length;
  const hiddenCharacterCount = Math.max(
    0,
    totalCharacterCount - recentCharacterItems.length,
  );

  const recentMotionItems = useMemo(() => {
    const items: LibraryMotion[] = [];
    const seen = new Set<string>();

    const push = (motion: LibraryMotion) => {
      if (seen.has(motion.id)) return;
      seen.add(motion.id);
      items.push(motion);
    };

    for (const ref of recentMotions) {
      if (items.length >= RECENT_MOTIONS_VISIBLE) break;
      const motion = libraryMotions.find((m) => m.id === ref.id);
      if (motion) push(motion);
    }

    if (referenceMotionId) {
      const selected = libraryMotions.find(
        (m) => m.id === referenceMotionId,
      );
      if (selected && !seen.has(selected.id)) {
        if (items.length >= RECENT_MOTIONS_VISIBLE) items.pop();
        push(selected);
      }
    }

    for (const motion of [...libraryMotions].sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    )) {
      if (items.length >= RECENT_MOTIONS_VISIBLE) break;
      push(motion);
    }

    return items.slice(0, RECENT_MOTIONS_VISIBLE);
  }, [recentMotions, libraryMotions, referenceMotionId]);

  const hiddenMotionCount = Math.max(
    0,
    libraryMotions.length - recentMotionItems.length,
  );

  const visibleLibraryMotions = useMemo(() => {
    if (libraryMotionsExpanded) return libraryMotions;

    const sorted = [...libraryMotions].sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
    const visible = sorted.slice(0, LIBRARY_MOTIONS_VISIBLE);

    const selectedId = value.generatedMotionId;
    if (selectedId && !visible.some((motion) => motion.id === selectedId)) {
      const selected = libraryMotions.find((motion) => motion.id === selectedId);
      if (selected) {
        visible.pop();
        visible.unshift(selected);
      }
    }

    return visible;
  }, [
    libraryMotions,
    libraryMotionsExpanded,
    value.generatedMotionId,
  ]);

  const hiddenLibraryMotionCount = Math.max(
    0,
    libraryMotions.length - LIBRARY_MOTIONS_VISIBLE,
  );

  const blobUrlToBase64 = async (blobUrl: string) => {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return {
      base64: btoa(binary),
      mimeType: blob.type || "image/jpeg",
    };
  };

  const applyCaptionToGeneratedMotion = async () => {
    if (!value.generatedMotionId || value.isGenerating) return;
    if (!value.overlayText.trim()) {
      patch({ generationError: "Add text overlay copy before applying caption." });
      return;
    }

    patch({ isGenerating: true, generationError: null });

    try {
      const overlayPngBase64 = await captureCaptionPng(
        value.overlayText,
        value.overlayStyle,
      );
      const res = await fetch("/api/library/hooks/apply-overlay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motionId: value.generatedMotionId,
          overlayText: value.overlayText,
          overlayStyle: value.overlayStyle,
          overlayPngBase64,
          actionPrompt: value.actionPrompt,
          referenceMotionId,
          characterSource: value.characterSource,
          characterPresetId: value.characterPresetId,
        }),
      });
      const data = (await res.json()) as {
        url?: string;
        id?: string;
        error?: string;
      };
      if (!res.ok || !data.url || !data.id) {
        throw new Error(data.error || "Could not apply caption.");
      }

      patch({
        isGenerating: false,
        generatedHookId: data.id,
        generatedClipUrl: data.url,
        generatedOverlaySnapshot: {
          text: value.overlayText.trim(),
          style: { ...value.overlayStyle },
        },
        generationError: null,
      });
      await loadLibrary();
    } catch (err) {
      patch({
        isGenerating: false,
        generationError:
          err instanceof Error ? err.message : "Could not apply caption.",
      });
    }
  };

  const generateClip = async () => {
    if (value.isGenerating || isLibraryMode) return;

    patch({
      isGenerating: true,
      generationError: null,
      generationNotice: null,
    });

    try {
      let imageBase64: string | null = null;
      let imageMimeType: string | null = null;

      if (value.characterSource === "upload" && value.uploadedImageUrl) {
        const encoded = await blobUrlToBase64(value.uploadedImageUrl);
        imageBase64 = encoded.base64;
        imageMimeType = encoded.mimeType;
      }

      const res = await fetch("/api/generate-hook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionPrompt: value.actionPrompt,
          characterSource: "upload",
          characterPresetId: null,
          characterTagline: value.uploadedImageName,
          referenceMotionId: referenceMotionId,
          imageBase64,
          imageMimeType,
          videoModel: videoModelChoice,
        }),
      });

      const data = (await res.json()) as {
        url?: string;
        rawUrl?: string;
        motion?: LibraryMotion;
        motionId?: string;
        error?: string;
        actionPrompt?: string;
        fallbackNote?: string | null;
      };
      if (!res.ok || !data.url || !data.motionId) {
        throw new Error(data.error || "Generation failed.");
      }

      if (data.motion) {
        setLibraryMotions((current) => [
          data.motion!,
          ...current.filter((m) => m.id !== data.motion!.id),
        ]);
        setRecentMotions(touchRecentMotion(data.motion.id));
      }

      patch({
        isGenerating: false,
        generatedMotionId: data.motionId,
        generatedHookId: null,
        generatedClipUrl: data.rawUrl ?? data.url,
        generatedRawClipUrl: data.rawUrl ?? data.url,
        generatedOverlaySnapshot: null,
        overlayText: "",
        generationError: null,
        generationNotice: data.fallbackNote ?? null,
        ...(data.actionPrompt ? { actionPrompt: data.actionPrompt } : {}),
      });
      await loadLibrary();
    } catch (err) {
      patch({
        isGenerating: false,
        ...clearGeneratedPreview,
        generationError:
          err instanceof Error ? err.message : "Generation failed.",
      });
    }
  };

  const applyCaption = async () => {
    await applyCaptionToGeneratedMotion();
  };

  const hasGeneratedClip = Boolean(
    value.generatedMotionId ||
      value.generatedRawClipUrl ||
      value.generatedHookId,
  );

  const canGenerateClip =
    !value.isGenerating &&
    !isLibraryMode &&
    Boolean(
      (value.actionPrompt.trim() || referenceMotionId) &&
        (value.characterSource === "upload"
          ? Boolean(value.uploadedImageUrl)
          : Boolean(value.characterPresetId)),
    );

  const selectedReferenceMotion = libraryMotions.find(
    (m) => m.id === referenceMotionId,
  );

  const referencePreviewMotion =
    libraryMotions.find(
      (m) => m.id === (referencePreviewId ?? referenceMotionId),
    ) ?? null;

  const hasReferenceMotion = Boolean(referenceMotionId);

  const libraryPreviewEditing =
    isLibraryMode &&
    Boolean(value.generatedMotionId) &&
    Boolean(value.generatedClipUrl);

  const captionIsDirty = Boolean(
    value.overlayText.trim() &&
      value.generatedClipUrl &&
      hookNeedsOverlayBurn({
        text: value.overlayText,
        storedText: value.generatedOverlaySnapshot?.text ?? "",
        overlayBurned: Boolean(value.generatedOverlaySnapshot),
        storedStyle: value.generatedOverlaySnapshot?.style,
        requestedStyle: value.overlayStyle,
      }),
  );

  const canApplyCaption =
    !value.isGenerating &&
    Boolean(value.overlayText.trim()) &&
    Boolean(value.generatedMotionId) &&
    (captionIsDirty || !value.generatedOverlaySnapshot);

  const canContinue =
    Boolean(value.generatedClipUrl) &&
    !value.isGenerating &&
    Boolean(value.overlayText.trim()) &&
    Boolean(value.generatedOverlaySnapshot?.text?.trim());

  const previewUsesRawVideo = Boolean(
    value.generatedRawClipUrl &&
      value.overlayText.trim() &&
      (captionIsDirty || !value.generatedOverlaySnapshot),
  );

  const previewVideoSrc = previewUsesRawVideo
    ? value.generatedRawClipUrl
    : value.generatedClipUrl;

  const showLiveOverlay =
    Boolean(value.overlayText.trim()) &&
    (!value.generatedClipUrl || previewUsesRawVideo || libraryPreviewEditing);

  const hookPreviewPanel = (
    <div className="rounded-2xl border border-border bg-surface-raised/60 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
        Live preview · 9:16
      </p>
      <div
        ref={previewFrameRef}
        className="relative mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-[1.25rem] border border-border bg-black shadow-[0_12px_40px_rgba(0,0,0,0.4)]"
      >
        <div className="absolute inset-0">
          {previewVideoSrc &&
          !previewVideoSrc.startsWith("placeholder:") ? (
            <video
              key={previewVideoSrc}
              src={previewVideoSrc}
              className="h-full w-full object-cover"
              autoPlay
              loop
              muted
              playsInline
              controls
            />
          ) : value.uploadedImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value.uploadedImageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-900 text-muted">
              <ImagePlus className="h-8 w-8 opacity-40" />
              <span className="text-xs">
                {isLibraryMode ? "Select a library motion" : "Select a character"}
              </span>
            </div>
          )}
        </div>

        {showLiveOverlay && (
            <div className="absolute inset-0 z-10 overflow-hidden">
              <div
                className="absolute left-1/2 top-0 origin-top"
                style={{
                  width: CAPTION_FRAME.width,
                  height: CAPTION_FRAME.height,
                  transform: `translateX(-50%) scale(${previewScale})`,
                }}
              >
                <DraggableCaptionOverlay
                  key={`${value.overlayText}-${previewUsesRawVideo ? "raw" : "final"}`}
                  text={value.overlayText}
                  style={value.overlayStyle}
                  onPositionChange={handleOverlayPositionChange}
                />
              </div>
            </div>
          )}

        <AnimatePresence>
          {value.isGenerating && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm"
            >
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
              <p className="text-xs font-medium text-white/90">
                {isLibraryMode ? "Burning caption…" : "Animating character…"}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {previewVideoSrc && !value.isGenerating && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute left-3 top-3 z-20 rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold text-accent-fg"
          >
            {value.generatedOverlaySnapshot?.text?.trim()
              ? "Hook ready"
              : "Motion ready"}
          </motion.div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
        <section className="rounded-2xl border border-border bg-surface/70 p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight">
                Character
              </h2>
              <p className="mt-1 text-sm text-muted">
                Pick a saved motion from your library and add a caption to create
                a hook, or upload a character photo to generate a new motion.
              </p>
            </div>
            <div className="flex flex-wrap rounded-lg border border-border bg-surface-raised p-0.5">
              {(
                [
                  { id: "upload", label: "Characters", icon: ImagePlus },
                  { id: "library", label: "Motions", icon: Clapperboard },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSource(id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    value.characterSource === id
                      ? "bg-accent text-accent-fg"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {value.characterSource === "upload" ? (
              <motion.div
                key="characters"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void handleFile(e.target.files?.[0]);
                    e.currentTarget.value = "";
                  }}
                />

                {libraryLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading characters…
                  </div>
                ) : (
                  <div className="space-y-3">
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      <li>
                        <button
                          type="button"
                          disabled={uploadingCharacter}
                          onClick={() => fileRef.current?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOver(true);
                          }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOver(false);
                            void handleFile(e.dataTransfer.files?.[0]);
                          }}
                          className={cn(
                            "flex h-full min-h-[11rem] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-6 transition-colors",
                            dragOver
                              ? "border-accent bg-accent/5"
                              : "border-border hover:border-muted hover:bg-surface-hover/40",
                          )}
                        >
                          {uploadingCharacter ? (
                            <Loader2 className="h-6 w-6 animate-spin text-accent" />
                          ) : (
                            <Upload className="h-6 w-6 text-muted" />
                          )}
                          <span className="text-xs font-medium">
                            Upload photo
                          </span>
                          <span className="text-center text-[10px] text-muted">
                            PNG or JPG · saved to your library
                          </span>
                        </button>
                      </li>

                      {(charactersExpanded
                        ? [
                            ...CHARACTER_PRESETS.map((preset) => ({
                              kind: "preset" as const,
                              preset,
                            })),
                            ...libraryCharacters.map((character) => ({
                              kind: "library" as const,
                              character,
                            })),
                          ]
                        : recentCharacterItems
                      ).map((item) =>
                        item.kind === "preset" ? (
                          <li key={`preset-${item.preset.id}`}>
                            <button
                              type="button"
                              onClick={() =>
                                selectCharacterPhoto({
                                  url: item.preset.imageUrl,
                                  name: item.preset.tagline,
                                  characterPresetId: item.preset.id,
                                })
                              }
                              className={cn(
                                "group relative w-full overflow-hidden rounded-xl border text-left transition-all",
                                isCharacterSelected({
                                  presetId: item.preset.id,
                                })
                                  ? "border-accent ring-1 ring-accent/40"
                                  : "border-border hover:border-muted",
                              )}
                            >
                              <div className="aspect-[3/4] bg-black">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={item.preset.imageUrl}
                                  alt={item.preset.tagline}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-8">
                                <p className="text-sm font-semibold text-white">
                                  {item.preset.tagline}
                                </p>
                              </div>
                              {isCharacterSelected({
                                presetId: item.preset.id,
                              }) ? (
                                <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-fg">
                                  Selected
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ) : (
                          <li key={`library-${item.character.id}`}>
                            <div
                              className={cn(
                                "relative overflow-hidden rounded-xl border transition-all",
                                isCharacterSelected({
                                  libraryId: item.character.id,
                                })
                                  ? "border-accent ring-1 ring-accent/40"
                                  : "border-border",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  selectCharacterPhoto({
                                    url: item.character.url,
                                    name: item.character.name,
                                    characterLibraryId: item.character.id,
                                  })
                                }
                                className="block w-full text-left"
                              >
                                <div className="aspect-[3/4] bg-black">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={item.character.url}
                                    alt={item.character.name}
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-8">
                                  <p className="truncate text-sm font-semibold text-white">
                                    {item.character.name}
                                  </p>
                                  <p className="text-[11px] text-white/70">
                                    Your upload
                                  </p>
                                </div>
                                {isCharacterSelected({
                                  libraryId: item.character.id,
                                }) ? (
                                  <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-fg">
                                    Selected
                                  </span>
                                ) : null}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void deleteCharacterPhoto(
                                    item.character.id,
                                    item.character.name,
                                  )
                                }
                                className="absolute left-2 top-2 rounded-full bg-black/60 p-1.5 text-white/80 transition-colors hover:bg-black/80 hover:text-white"
                                aria-label={`Delete ${item.character.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </li>
                        ),
                      )}
                    </ul>

                    {hiddenCharacterCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => setCharactersExpanded((open) => !open)}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-muted hover:text-foreground"
                      >
                        {charactersExpanded ? (
                          <>
                            <ChevronUp className="h-3.5 w-3.5" />
                            Show fewer characters
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3.5 w-3.5" />
                            Show {hiddenCharacterCount} more character
                            {hiddenCharacterCount === 1 ? "" : "s"}
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>
                )}

                {value.uploadedImageUrl ? (
                  <p className="text-xs text-muted">
                    Selected:{" "}
                    <span className="text-foreground">
                      {value.uploadedImageName}
                    </span>
                    . Photorealistic portraits work best. Avoid photos of
                    celebrities or people you don&apos;t have rights to — Gemini
                    may block those.
                  </p>
                ) : (
                  <p className="text-xs text-muted">
                    Built-in characters are photorealistic fictional portraits.
                    Upload your own front-facing photo to use a custom face.
                  </p>
                )}
              </motion.div>
            ) : value.characterSource === "library" ? (
              <motion.div
                key="library"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                {libraryLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading motions…
                  </div>
                ) : libraryMotions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-12 text-muted">
                    <Clapperboard className="h-8 w-8 opacity-40" />
                    <p className="text-sm">No motions in your library yet</p>
                    <p className="text-xs">
                      Generate a clip on the Characters tab, or upload in Library →
                      Motions
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                      {visibleLibraryMotions.map((motion) => {
                        const selected = value.generatedMotionId === motion.id;
                        return (
                          <li key={motion.id}>
                            <button
                              type="button"
                              onClick={() => selectLibraryMotion(motion)}
                              className={cn(
                                "group relative w-full overflow-hidden rounded-xl border text-left transition-all",
                                selected
                                  ? "border-accent ring-1 ring-accent/40"
                                  : "border-border hover:border-muted",
                              )}
                            >
                              <ReelPlayer
                                size="xs"
                                src={motion.url}
                                muted
                                playsInline
                                preload="metadata"
                              />
                              <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                                <p className="line-clamp-4 text-[10px] font-medium leading-snug text-white">
                                  {motion.actionPrompt || motion.name}
                                </p>
                              </div>
                              {selected ? (
                                <span className="absolute right-1.5 top-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold text-accent-fg">
                                  Selected
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>

                    {hiddenLibraryMotionCount > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setLibraryMotionsExpanded((open) => !open)
                        }
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-muted hover:text-foreground"
                      >
                        {libraryMotionsExpanded ? (
                          <>
                            <ChevronUp className="h-3.5 w-3.5" />
                            Show fewer motions
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3.5 w-3.5" />
                            See {hiddenLibraryMotionCount} more motion
                            {hiddenLibraryMotionCount === 1 ? "" : "s"}
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>
                )}
                {value.generatedMotionId && (
                  <p className="mt-3 text-xs text-muted">
                    Add a caption below, then click{" "}
                    <span className="text-foreground">Apply caption</span> to
                    create a hook from this motion.
                  </p>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>

        {!isLibraryMode && (
          <section className="rounded-2xl border border-border bg-surface/70 p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <Video className="h-4 w-4 text-accent" />
                  <h2 className="font-display text-lg font-semibold tracking-tight">
                    Reference motion
                  </h2>
                </div>
                <p className="text-sm text-muted">
                  Optional — app-wide default for hook generation. Pick from your
                  motion library. Upload clips in Library → Motions.
                </p>
              </div>
              {hasReferenceMotion ? (
                <button
                  type="button"
                  onClick={() => {
                    selectReferenceMotion(null);
                    patch({ actionPrompt: "" });
                  }}
                  className="text-xs font-medium text-muted hover:text-foreground"
                >
                  Clear
                </button>
              ) : null}
            </div>

            {libraryLoading ? (
              <div className="flex items-center gap-2 py-8 text-xs text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading motion library…
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
                <div className="min-w-0 space-y-3">
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                  {(motionsExpanded ? libraryMotions : recentMotionItems).map(
                    (motion) => {
                      const selected = referenceMotionId === motion.id;
                      const previewing = referencePreviewId === motion.id;
                      return (
                        <li key={motion.id}>
                          <div
                            className={cn(
                              "relative overflow-hidden rounded-xl border transition-all",
                              selected
                                ? "border-accent ring-1 ring-accent/40"
                                : previewing
                                  ? "border-accent/50"
                                  : "border-border",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => setReferencePreviewId(motion.id)}
                              className="group relative block w-full text-left"
                            >
                              <div className={reelFrameClass("xs", "relative")}>
                                <video
                                  src={motion.url}
                                  className={reelVideoClass}
                                  muted
                                  playsInline
                                  preload="metadata"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                                  <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-semibold text-white">
                                    <Play className="h-3 w-3 fill-current" />
                                    Preview
                                  </span>
                                </div>
                              </div>
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2 pt-6">
                                <p className="line-clamp-2 text-[11px] font-semibold text-white">
                                  {motion.name}
                                </p>
                              </div>
                              {selected ? (
                                <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-fg">
                                  Selected
                                </span>
                              ) : null}
                            </button>
                            <div className="flex gap-1 border-t border-border bg-surface-raised p-1.5">
                              <button
                                type="button"
                                onClick={() => setReferencePreviewId(motion.id)}
                                className="flex-1 rounded-md border border-border bg-surface px-1.5 py-1 text-[10px] font-medium text-muted transition-colors hover:border-muted hover:text-foreground"
                              >
                                Preview
                              </button>
                              <button
                                type="button"
                                onClick={() => selectReferenceMotion(motion)}
                                className={cn(
                                  "flex-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-all",
                                  selected
                                    ? "bg-accent/15 text-accent"
                                    : "bg-accent text-accent-fg hover:brightness-110",
                                )}
                              >
                                {selected ? "Selected" : "Use"}
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                void deleteMotionClip(motion.id, motion.name)
                              }
                              className="absolute left-2 top-2 rounded-full bg-black/60 p-1.5 text-white/80 transition-colors hover:bg-black/80 hover:text-white"
                              aria-label={`Delete ${motion.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    },
                  )}
                </ul>

                {libraryMotions.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted">
                    No saved motions yet. Upload clips in{" "}
                    <a href="/library?tab=motions" className="text-accent hover:underline">
                      Library → Motions
                    </a>
                    , or generate a clip on the Characters tab.
                  </p>
                ) : null}

                {hiddenMotionCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setMotionsExpanded((open) => !open)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-muted hover:text-foreground"
                  >
                    {motionsExpanded ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" />
                        Show fewer motions
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        Show {hiddenMotionCount} more motion
                        {hiddenMotionCount === 1 ? "" : "s"}
                      </>
                    )}
                  </button>
                ) : null}

                {selectedReferenceMotion ? (
                  <p className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-accent">
                    Motion locked: “
                    {selectedReferenceMotion.actionPrompt ||
                      selectedReferenceMotion.name}
                    ”
                  </p>
                ) : null}
                </div>

                <div className="lg:sticky lg:top-24">
                  {referencePreviewMotion ? (
                    <div className="rounded-xl border border-border bg-surface-raised/60 p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-accent">
                        Motion preview
                      </p>
                      <div className="mt-2 space-y-3">
                        <ReelPlayer
                          key={referencePreviewMotion.id}
                          size="mdLg"
                          frameClassName="mx-auto rounded-lg"
                          src={referencePreviewMotion.url}
                          controls
                          playsInline
                          preload="metadata"
                        />
                        <div className="space-y-2">
                          <p className="line-clamp-3 text-sm font-medium">
                            {referencePreviewMotion.name}
                          </p>
                          {referencePreviewMotion.actionPrompt ? (
                            <p className="text-xs text-muted">
                              {referencePreviewMotion.actionPrompt}
                            </p>
                          ) : null}
                          <button
                            type="button"
                            onClick={() =>
                              selectReferenceMotion(referencePreviewMotion)
                            }
                            className={cn(
                              "inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
                              referenceMotionId === referencePreviewMotion.id
                                ? "bg-accent/15 text-accent"
                                : "bg-accent text-accent-fg hover:brightness-110",
                            )}
                          >
                            {referenceMotionId === referencePreviewMotion.id
                              ? "Motion selected"
                              : "Use this motion"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-raised/40 p-4 text-center">
                      <Play className="h-8 w-8 text-muted/40" />
                      <p className="text-xs text-muted">
                        Click Preview on a motion to see it here
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {!isLibraryMode && (
          <section className="rounded-2xl border border-border bg-surface/70 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-accent" />
              <h2 className="font-display text-lg font-semibold tracking-tight">
                Action prompt
              </h2>
            </div>
            <p className="mb-3 text-sm text-muted">
              {selectedReferenceMotion
                ? "Pre-filled from your reference motion — edit if you want a slight variation."
                : "Describe how the character should move for the 4-second hook."}
            </p>
            <textarea
              value={value.actionPrompt}
              onChange={(e) => patch({ actionPrompt: e.target.value })}
              rows={3}
              placeholder="e.g. Laughing happily with hand over the mouth continuously"
              className="w-full resize-none rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted/60 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {ACTION_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => {
                    void persistReferenceMotion(null);
                    patch({ actionPrompt: prompt });
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[11px] transition-colors",
                    value.actionPrompt === prompt && !hasReferenceMotion
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-border text-muted hover:border-muted hover:text-foreground",
                  )}
                >
                  {prompt.length > 42 ? `${prompt.slice(0, 42)}…` : prompt}
                </button>
              ))}
            </div>
          </section>
        )}

        {!isLibraryMode && (
          <section className="rounded-2xl border border-border bg-surface/70 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Clapperboard className="h-4 w-4 text-accent" />
              <h2 className="font-display text-lg font-semibold tracking-tight">
                Video model
              </h2>
            </div>
            <p className="mb-3 text-sm text-muted">
              Choose which Gemini model generates your 4-second hook clip.
            </p>
            <div className="flex flex-wrap gap-2">
              {VIDEO_MODEL_OPTIONS.map((option) => {
                const active = videoModelChoice === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => selectVideoModel(option.id)}
                    disabled={value.isGenerating}
                    className={cn(
                      "rounded-xl border px-3.5 py-2 text-xs font-medium transition-colors disabled:opacity-50",
                      active
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-surface-raised text-muted hover:border-muted hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted">{selectedVideoModel.description}</p>
            {usesCharacterPhoto && videoModelChoice === OMNI_FLASH_MODEL ? (
              <p className="mt-2 text-xs text-amber-400">
                Omni Flash can&apos;t animate character photos — Veo Fast will be
                used instead.
              </p>
            ) : null}
            {usesCharacterPhoto && videoModelChoice === KLING_V3_TURBO_MODEL ? (
              <p className="mt-2 text-xs text-amber-400">
                Kling Turbo needs a public HTTPS tunnel for character photos. Set{" "}
                <code className="text-foreground">INSTAGRAM_MEDIA_BASE_URL</code>{" "}
                or use Kling 3.0 Std/Pro instead.
              </p>
            ) : null}
            {isKlingModel(videoModelChoice) ? (
              <p className="mt-2 text-xs text-muted">
                Uses your Kling API key from{" "}
                <code className="text-foreground">KLING_API_KEY</code>.
              </p>
            ) : null}
          </section>
        )}

        {!isLibraryMode && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canGenerateClip || value.isGenerating}
              onClick={() => void generateClip()}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all",
                canGenerateClip && !value.isGenerating
                  ? "bg-accent text-accent-fg shadow-[0_0_28px_var(--glow)] hover:brightness-110"
                  : "cursor-not-allowed bg-surface-raised text-muted",
              )}
            >
              {value.isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {generatingLabel(videoModelChoice)}
                </>
              ) : hasGeneratedClip ? (
                <>
                  <Sparkles className="h-4 w-4" />
                  Regenerate clip
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate hook clip
                </>
              )}
            </button>
            {hasGeneratedClip ? (
              <p className="text-sm text-muted">
                Motion saved to your library. Add your caption below to create a
                hook.
              </p>
            ) : !canGenerateClip && !value.isGenerating ? (
              <p className="text-sm text-muted">
                Select a character and motion prompt to generate your clip.
              </p>
            ) : null}
          </div>
        )}

        {(isLibraryMode || hasGeneratedClip) && (
        <section className="rounded-2xl border border-border bg-surface/70 p-5">
          <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Type className="h-4 w-4 text-accent" />
            <h2 className="font-display text-lg font-semibold tracking-tight">
              Caption
              <span className="ml-1.5 text-sm font-normal text-accent">*</span>
            </h2>
            <p className="w-full text-xs text-muted sm:w-auto sm:ml-auto">
              {isLibraryMode
                ? "Add a caption to turn this motion into a hook"
                : "Add caption text after your clip is generated"}
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
            <div className="order-2 min-w-0 space-y-4 lg:order-1">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={value.overlayText}
                  onChange={(e) => {
                    if (!selectingCaptionRef.current) {
                      setSelectedLibraryCaptionId(null);
                      setCaptionSaveNotice(null);
                    }
                    selectingCaptionRef.current = false;
                    patch({ overlayText: e.target.value });
                  }}
                  placeholder={
                    isLibraryMode
                      ? "Type a new caption for this hook…"
                      : "Wait for this trick…"
                  }
                  className="min-w-[12rem] flex-1 rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted/60 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
                />
                {trimmedOverlayText ? (
                  <>
                    {canSaveCaptionToLibrary ? (
                      <button
                        type="button"
                        disabled={savingCaption}
                        onClick={() => void saveCaptionToLibrary()}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
                      >
                        {savingCaption ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        Save
                      </button>
                    ) : captionAlreadyInLibrary ? (
                      <span className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-xs font-medium text-muted">
                        In library
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        patch({ overlayText: "" });
                        setSelectedLibraryCaptionId(null);
                        setCaptionSaveNotice(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-xs font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  </>
                ) : null}
              </div>
              {captionSaveNotice ? (
                <p
                  className={cn(
                    "text-xs",
                    captionSaveNotice.includes("Could not") ||
                      captionSaveNotice.includes("already exists")
                      ? "text-red-300"
                      : "text-muted",
                  )}
                >
                  {captionSaveNotice}
                </p>
              ) : null}

              <HookCaptionTools
                overlayText={value.overlayText}
                onSelect={handleCaptionSelect}
                onLibraryChange={setLibraryCaptions}
                refreshToken={captionLibraryRefresh}
              />

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                  Add emoji
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {OVERLAY_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => appendOverlayEmoji(emoji)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-raised text-lg transition-colors hover:border-accent/40 hover:bg-surface-hover"
                      aria-label={`Add ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted">
                Format presets
              </p>
              {!savingPreset ? (
                <button
                  type="button"
                  onClick={() => setSavingPreset(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  Save current
                </button>
              ) : null}
            </div>

            {savingPreset ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-raised p-2.5">
                <input
                  autoFocus
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSavePreset();
                    if (e.key === "Escape") {
                      setSavingPreset(false);
                      setPresetName("");
                    }
                  }}
                  placeholder="Preset name…"
                  className="min-w-[10rem] flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent/50"
                />
                <button
                  type="button"
                  onClick={handleSavePreset}
                  disabled={!presetName.trim()}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSavingPreset(false);
                    setPresetName("");
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground"
                  aria-label="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}

            {formatPresets.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted">
                No saved presets yet. Dial in your format, then save it.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {formatPresets.map((preset) => {
                  const active = stylesMatch(value.overlayStyle, preset.style);
                  return (
                    <div
                      key={preset.id}
                      className={cn(
                        "group relative rounded-xl border bg-surface-raised p-3 text-left transition-all",
                        active
                          ? "border-accent ring-1 ring-accent/40"
                          : "border-border hover:border-muted",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => patchStyle(preset.style)}
                        className="w-full text-left"
                      >
                        <span className="mb-2 block truncate pr-8 text-[11px] font-medium text-muted">
                          {preset.name}
                        </span>
                        <span
                          className={cn(
                            "inline-block max-w-full truncate text-sm leading-tight",
                            overlayFontClass(preset.style),
                            preset.style.bold && "font-bold",
                            preset.style.uppercase && "uppercase",
                            overlayPaddingClass(preset.style),
                            overlayStyleClass(preset.style),
                          )}
                          style={captionTextStyle({
                            ...preset.style,
                            fontSize: Math.min(preset.style.fontSize, 28),
                          })}
                        >
                          Aa
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${preset.name}`}
                        onClick={() => handleDeletePreset(preset.id)}
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-muted opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Word-like formatting toolbar */}
          <div className="space-y-3 rounded-xl border border-border bg-surface-raised/70 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
              Format
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                Font
                <select
                  value={value.overlayStyle.fontFamily}
                  onChange={(e) =>
                    patchStyle({
                      fontFamily: e.target
                        .value as OverlayStyle["fontFamily"],
                    })
                  }
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent/50"
                >
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
                <button
                  type="button"
                  aria-label="Decrease size"
                  onClick={() =>
                    patchStyle({
                      fontSize: Math.max(
                        20,
                        (value.overlayStyle.fontSize ?? 48) - 4,
                      ),
                    })
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <select
                  value={value.overlayStyle.fontSize ?? 48}
                  onChange={(e) =>
                    patchStyle({
                      fontSize: Number(e.target.value),
                    })
                  }
                  className="h-7 min-w-[3.5rem] bg-transparent text-center text-xs text-foreground outline-none"
                >
                  {!FONT_SIZE_OPTIONS.includes(value.overlayStyle.fontSize) && (
                    <option value={value.overlayStyle.fontSize}>
                      {value.overlayStyle.fontSize}
                    </option>
                  )}
                  {FONT_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Increase size"
                  onClick={() =>
                    patchStyle({
                      fontSize: Math.min(
                        120,
                        (value.overlayStyle.fontSize ?? 48) + 4,
                      ),
                    })
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  patchStyle({
                    bold: !value.overlayStyle.bold,
                  })
                }
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
                  value.overlayStyle.bold
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-border text-muted hover:text-foreground",
                )}
                aria-label="Bold"
              >
                <Bold className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() =>
                  patchStyle({
                    italic: !value.overlayStyle.italic,
                  })
                }
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
                  value.overlayStyle.italic
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-border text-muted hover:text-foreground",
                )}
                aria-label="Italic"
              >
                <Italic className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() =>
                  patchStyle({
                    uppercase: !value.overlayStyle.uppercase,
                  })
                }
                className={cn(
                  "flex h-8 items-center rounded-lg border px-2 text-[11px] font-semibold transition-colors",
                  value.overlayStyle.uppercase
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-border text-muted hover:text-foreground",
                )}
              >
                TT
              </button>

              <button
                type="button"
                onClick={() =>
                  patchStyle({
                    highlight: !value.overlayStyle.highlight,
                  })
                }
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
                  value.overlayStyle.highlight
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-border text-muted hover:text-foreground",
                )}
              >
                <Highlighter className="h-3.5 w-3.5" />
                Highlight
              </button>

              <div className="ml-1 flex items-center gap-1.5">
                {TEXT_COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Color ${color}`}
                    onClick={() =>
                      patchStyle({ textColor: color })
                    }
                    className={cn(
                      "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
                      (value.overlayStyle.textColor ?? "#FFFFFF").toUpperCase() ===
                        color.toUpperCase()
                        ? "border-accent"
                        : "border-border",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <input
                  type="color"
                  value={value.overlayStyle.textColor || "#FFFFFF"}
                  onChange={(e) =>
                    patchStyle({
                      textColor: e.target.value,
                    })
                  }
                  className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent"
                  title="Custom color"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted">
                Border
                <select
                  value={value.overlayStyle.borderWidth ?? 0}
                  onChange={(e) =>
                    patchStyle({
                      borderWidth: Number(e.target.value),
                    })
                  }
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent/50"
                >
                  {BORDER_WIDTH_OPTIONS.map((width) => (
                    <option key={width} value={width}>
                      {width === 0 ? "None" : `${width}px`}
                    </option>
                  ))}
                </select>
              </label>

              <div
                className={cn(
                  "flex items-center gap-1.5",
                  (value.overlayStyle.borderWidth ?? 0) === 0 &&
                    "pointer-events-none opacity-40",
                )}
              >
                <span className="text-[11px] text-muted">Border color</span>
                {BORDER_COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Border color ${color}`}
                    onClick={() =>
                      patchStyle({
                        borderColor: color,
                      })
                    }
                    className={cn(
                      "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
                      (value.overlayStyle.borderColor ?? "#000000").toUpperCase() ===
                        color.toUpperCase()
                        ? "border-accent"
                        : "border-border",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <input
                  type="color"
                  value={value.overlayStyle.borderColor || "#000000"}
                  onChange={(e) =>
                    patchStyle({
                      borderColor: e.target.value,
                    })
                  }
                  className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent"
                  title="Custom border color"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted">Align</span>
                <div className="flex rounded-lg border border-border bg-surface p-0.5">
                  {(
                    [
                      { id: "left" as const, icon: AlignLeft },
                      { id: "center" as const, icon: AlignCenter },
                      { id: "right" as const, icon: AlignRight },
                    ] as const
                  ).map(({ id, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      aria-label={ALIGN_OPTIONS.find((a) => a.id === id)?.label}
                      onClick={() =>
                        patchStyle({ align: id })
                      }
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                        (value.overlayStyle.align ?? "center") === id
                          ? "bg-surface-hover text-foreground"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted">Position</span>
                <div className="flex rounded-lg border border-border bg-surface p-0.5">
                  {LAYOUT_OPTIONS.map((layout) => (
                    <button
                      key={layout.id}
                      type="button"
                      onClick={() =>
                        patchStyle({
                          layout: layout.id,
                          positionX: null,
                          positionY: null,
                        })
                      }
                      className={cn(
                        "rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                        value.overlayStyle.layout === layout.id &&
                          !hasCustomOverlayPosition(value.overlayStyle)
                          ? "bg-surface-hover text-foreground"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {layout.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            </div>
            </div>

            <div className="order-1 w-full lg:order-2 lg:sticky lg:top-24 lg:self-start">
              {hookPreviewPanel}
            </div>
          </div>
        </section>
        )}

        {(isLibraryMode || hasGeneratedClip) && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canApplyCaption || value.isGenerating}
            onClick={() => void applyCaption()}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all",
              canApplyCaption && !value.isGenerating
                ? "bg-accent text-accent-fg shadow-[0_0_28px_var(--glow)] hover:brightness-110"
                : "cursor-not-allowed bg-surface-raised text-muted",
            )}
          >
            {value.isGenerating && (hasGeneratedClip || isLibraryMode) ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Applying caption…
              </>
            ) : (
              <>
                <Type className="h-4 w-4" />
                Apply caption
              </>
            )}
          </button>

          {onContinue && (
            <button
              type="button"
              disabled={!canContinue}
              onClick={onContinue}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-semibold transition-colors",
                canContinue
                  ? "border-border bg-surface-raised text-foreground hover:border-muted"
                  : "cursor-not-allowed border-border-subtle text-muted opacity-50",
              )}
            >
              Continue to demo →
            </button>
          )}

          {!canApplyCaption && !value.isGenerating && !value.overlayText.trim() && (
            <p className="w-full text-sm text-muted">
              {isLibraryMode
                ? "Type a caption above to create a hook from the selected motion."
                : "Type a caption above, then apply it to finish your hook."}
            </p>
          )}

          {value.generationError && (
            <p className="w-full text-sm text-danger">{value.generationError}</p>
          )}
          {value.generationNotice && !value.generationError && (
            <p className="w-full text-sm text-amber-400">{value.generationNotice}</p>
          )}
        </div>
        )}

        {!isLibraryMode && !hasGeneratedClip && value.generationError && (
          <p className="text-sm text-danger">{value.generationError}</p>
        )}
        {!isLibraryMode && !hasGeneratedClip && value.generationNotice && !value.generationError && (
          <p className="text-sm text-amber-400">{value.generationNotice}</p>
        )}
    </div>
  );
}
