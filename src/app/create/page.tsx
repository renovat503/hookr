"use client";

import Link from "next/link";
import { HookBuilder } from "@/components/hook/HookBuilder";
import { useProject } from "@/components/providers/ProjectProvider";

export default function CreateHookPage() {
  const { state, setHook } = useProject();
  const hookReady = Boolean(
    state.hook.generatedClipUrl &&
      state.hook.generatedOverlaySnapshot?.text?.trim(),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Build a 4-second hook
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Generate a motion clip first, then add a caption to create a hook.
          Motions are saved without text; hooks are motions with overlay burned in.
        </p>
      </div>

      {hookReady && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          Hook saved to library.{" "}
          <Link href="/library" className="font-medium text-accent hover:underline">
            View in Library →
          </Link>
        </div>
      )}

      <HookBuilder value={state.hook} onChange={setHook} />
    </div>
  );
}
