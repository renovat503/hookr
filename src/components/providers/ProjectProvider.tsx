"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_OVERLAY_STYLE } from "@/lib/constants";
import type { DemoClip, HookConfig, ProjectState } from "@/lib/types";

const initialHook: HookConfig = {
  characterSource: "upload",
  characterPresetId: null,
  libraryHookId: null,
  uploadedImageUrl: null,
  uploadedImageName: null,
  characterLibraryId: null,
  actionPrompt: "",
  overlayText: "",
  overlayStyle: DEFAULT_OVERLAY_STYLE,
  generatedClipUrl: null,
  generatedRawClipUrl: null,
  generatedHookId: null,
  generatedMotionId: null,
  generatedOverlaySnapshot: null,
  isGenerating: false,
  generationError: null,
  generationNotice: null,
};

type ProjectContextValue = {
  state: ProjectState;
  setHook: (hook: HookConfig) => void;
  selectDemo: (id: string) => void;
  addDemoClip: (clip: DemoClip) => void;
  selectedDemo: DemoClip | null;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProjectState>({
    step: "hook",
    hook: initialHook,
    selectedDemoId: null,
    demoClips: [],
  });

  useEffect(() => {
    void fetch("/api/library")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { demos?: DemoClip[] } | null) => {
        if (data?.demos?.length) {
          setState((prev) => ({
            ...prev,
            demoClips: data.demos!.map((d) => ({
              id: d.id,
              name: d.name,
              durationSeconds: d.durationSeconds,
              thumbnailUrl: null,
              url: d.url,
              uploadedAt: d.uploadedAt,
            })),
          }));
        }
      })
      .catch(() => {});
  }, []);

  const setHook = useCallback((hook: HookConfig) => {
    setState((prev) => ({ ...prev, hook }));
  }, []);

  const selectDemo = useCallback((id: string) => {
    setState((prev) => ({ ...prev, selectedDemoId: id }));
  }, []);

  const addDemoClip = useCallback((clip: DemoClip) => {
    setState((prev) => ({
      ...prev,
      demoClips: [clip, ...prev.demoClips.filter((c) => c.id !== clip.id)],
      selectedDemoId: clip.id,
    }));
  }, []);

  const selectedDemo = useMemo(
    () => state.demoClips.find((c) => c.id === state.selectedDemoId) ?? null,
    [state.demoClips, state.selectedDemoId],
  );

  const value = useMemo(
    () => ({ state, setHook, selectDemo, addDemoClip, selectedDemo }),
    [state, setHook, selectDemo, addDemoClip, selectedDemo],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within ProjectProvider");
  }
  return ctx;
}
