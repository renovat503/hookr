import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import {
  usesJsonWrite,
  usesPostgresRead,
  usesPostgresWrite,
} from "@/lib/config/storage-mode";
import {
  addCharacterPg,
  addDemoPg,
  addExportPg,
  addHookPg,
  addMotionPg,
  addMusicPg,
  readLibraryPg,
  removeLibraryItemPg,
  updateHookPg,
  writeLibraryPg,
} from "@/lib/db/stores/library";
import type {
  LibraryCharacter,
  LibraryData,
  LibraryDemo,
  LibraryExport,
  LibraryHook,
  LibraryMotion,
  LibraryMusic,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const MANIFEST_PATH = path.join(DATA_DIR, "library.json");

const EMPTY: LibraryData = {
  hooks: [],
  demos: [],
  music: [],
  exports: [],
  characters: [],
  motions: [],
};

function normalizeLibrary(data: Partial<LibraryData>): LibraryData {
  return {
    hooks: data.hooks ?? [],
    demos: data.demos ?? [],
    music: data.music ?? [],
    exports: data.exports ?? [],
    characters: data.characters ?? [],
    motions: data.motions ?? [],
  };
}

async function readLibraryJson(): Promise<LibraryData> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    return normalizeLibrary(JSON.parse(raw) as Partial<LibraryData>);
  } catch {
    return { ...EMPTY };
  }
}

async function writeLibraryJson(data: LibraryData) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(data, null, 2));
}

export async function readLibrary(): Promise<LibraryData> {
  if (usesPostgresRead()) {
    try {
      return await readLibraryPg();
    } catch (err) {
      console.error("[library] postgres read failed, falling back to json", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  return readLibraryJson();
}

export async function writeLibrary(data: LibraryData) {
  if (usesJsonWrite()) {
    await writeLibraryJson(data);
  }
  if (usesPostgresWrite()) {
    try {
      await writeLibraryPg(data);
    } catch (err) {
      console.error("[library] postgres write failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
}

async function withLibraryMutation<T>(
  mutate: (data: LibraryData) => T | Promise<T>,
): Promise<T> {
  const data = usesJsonWrite() ? await readLibraryJson() : await readLibrary();
  const result = await mutate(data);
  if (usesJsonWrite()) {
    await writeLibraryJson(data);
  }
  if (usesPostgresWrite()) {
    try {
      await writeLibraryPg(data);
    } catch (err) {
      console.error("[library] postgres sync failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  return result;
}

export async function addHook(hook: LibraryHook) {
  if (usesPostgresWrite()) {
    try {
      await addHookPg(hook);
    } catch (err) {
      console.error("[library] postgres addHook failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readLibraryJson();
    data.hooks.unshift(hook);
    await writeLibraryJson(data);
  }
  return hook;
}

export async function updateHook(hook: LibraryHook) {
  if (usesPostgresWrite()) {
    try {
      await updateHookPg(hook);
    } catch (err) {
      console.error("[library] postgres updateHook failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readLibraryJson();
    const index = data.hooks.findIndex((item) => item.id === hook.id);
    if (index >= 0) {
      data.hooks[index] = hook;
      await writeLibraryJson(data);
    }
  }
  return hook;
}

export async function addDemo(demo: LibraryDemo) {
  if (usesPostgresWrite()) {
    try {
      await addDemoPg(demo);
    } catch (err) {
      console.error("[library] postgres addDemo failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readLibraryJson();
    data.demos.unshift(demo);
    await writeLibraryJson(data);
  }
  return demo;
}

export async function addMusic(track: LibraryMusic) {
  if (usesPostgresWrite()) {
    try {
      await addMusicPg(track);
    } catch (err) {
      console.error("[library] postgres addMusic failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readLibraryJson();
    data.music.unshift(track);
    await writeLibraryJson(data);
  }
  return track;
}

export async function addCharacter(character: LibraryCharacter) {
  if (usesPostgresWrite()) {
    try {
      await addCharacterPg(character);
    } catch (err) {
      console.error("[library] postgres addCharacter failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readLibraryJson();
    data.characters.unshift(character);
    await writeLibraryJson(data);
  }
  return character;
}

export async function addMotion(motion: LibraryMotion) {
  if (usesPostgresWrite()) {
    try {
      await addMotionPg(motion);
    } catch (err) {
      console.error("[library] postgres addMotion failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readLibraryJson();
    data.motions.unshift(motion);
    await writeLibraryJson(data);
  }
  return motion;
}

export async function addExport(exp: LibraryExport) {
  if (usesPostgresWrite()) {
    try {
      await addExportPg(exp);
    } catch (err) {
      console.error("[library] postgres addExport failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    const data = await readLibraryJson();
    data.exports.unshift(exp);
    await writeLibraryJson(data);
  }
  return exp;
}

export async function removeLibraryItem(
  type: "hooks" | "demos" | "music" | "exports" | "characters" | "motions",
  id: string,
) {
  if (usesPostgresWrite()) {
    try {
      await removeLibraryItemPg(type, id);
    } catch (err) {
      console.error("[library] postgres remove failed", err);
      if (!usesJsonWrite()) throw err;
    }
  }
  if (usesJsonWrite()) {
    await withLibraryMutation((data) => {
      if (type === "hooks") {
        data.hooks = data.hooks.filter((item) => item.id !== id);
      } else if (type === "demos") {
        data.demos = data.demos.filter((item) => item.id !== id);
      } else if (type === "music") {
        data.music = data.music.filter((item) => item.id !== id);
      } else if (type === "characters") {
        data.characters = data.characters.filter((item) => item.id !== id);
      } else if (type === "motions") {
        data.motions = data.motions.filter((item) => item.id !== id);
      } else {
        data.exports = data.exports.filter((item) => item.id !== id);
      }
    });
  }
}

/** Bulk replace library — used by migration tooling. */
export async function replaceAllLibrary(data: LibraryData): Promise<void> {
  if (usesJsonWrite()) {
    await writeLibraryJson(data);
  }
  if (usesPostgresWrite()) {
    await writeLibraryPg(data);
  }
}
