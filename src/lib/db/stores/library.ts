import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  characters as charactersTable,
  demos as demosTable,
  exportsTable,
  hooks as hooksTable,
  motions as motionsTable,
  music as musicTable,
} from "@/lib/db/schema";
import type {
  LibraryCharacter,
  LibraryData,
  LibraryDemo,
  LibraryExport,
  LibraryHook,
  LibraryMotion,
  LibraryMusic,
} from "@/lib/types";

function rowToHook(row: typeof hooksTable.$inferSelect): LibraryHook {
  return {
    id: row.id,
    url: row.url,
    rawUrl: row.rawUrl,
    actionPrompt: row.actionPrompt,
    overlayText: row.overlayText,
    overlayStyle: row.overlayStyle ?? undefined,
    characterSource: row.characterSource,
    characterPresetId: row.characterPresetId,
    durationSeconds: row.durationSeconds,
    overlayBurned: row.overlayBurned,
    sourceHookId: row.sourceHookId,
    referenceMotionId: row.referenceMotionId,
    campaignId: row.campaignId,
    copiedFromHookId: row.copiedFromHookId,
    copiedFromCampaignId: row.copiedFromCampaignId,
    createdAt: row.createdAt,
  };
}

function rowToDemo(row: typeof demosTable.$inferSelect): LibraryDemo {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    durationSeconds: row.durationSeconds,
    uploadedAt: row.uploadedAt,
  };
}

function rowToMotion(row: typeof motionsTable.$inferSelect): LibraryMotion {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    actionPrompt: row.actionPrompt,
    durationSeconds: row.durationSeconds,
    sourceHookId: row.sourceHookId,
    uploadedAt: row.uploadedAt,
  };
}

function rowToMusic(row: typeof musicTable.$inferSelect): LibraryMusic {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    durationSeconds: row.durationSeconds,
    uploadedAt: row.uploadedAt,
  };
}

function rowToCharacter(
  row: typeof charactersTable.$inferSelect,
): LibraryCharacter {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    uploadedAt: row.uploadedAt,
  };
}

function rowToExport(row: typeof exportsTable.$inferSelect): LibraryExport {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    hookId: row.hookId,
    demoId: row.demoId,
    hookUrl: row.hookUrl,
    demoUrl: row.demoUrl,
    hookActionPrompt: row.hookActionPrompt,
    demoName: row.demoName,
    overlayText: row.overlayText,
    captionHash: row.captionHash,
    musicId: row.musicId,
    musicName: row.musicName,
    musicVolume: row.musicVolume,
    variation: row.variation,
    runFolder: row.runFolder,
    campaignId: row.campaignId,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export async function readLibraryPg(): Promise<LibraryData> {
  const db = getDb();
  const [hookRows, demoRows, motionRows, musicRows, characterRows, exportRows] =
    await Promise.all([
      db.select().from(hooksTable).orderBy(desc(hooksTable.createdAt)),
      db.select().from(demosTable).orderBy(desc(demosTable.uploadedAt)),
      db.select().from(motionsTable).orderBy(desc(motionsTable.uploadedAt)),
      db.select().from(musicTable).orderBy(desc(musicTable.uploadedAt)),
      db.select().from(charactersTable).orderBy(desc(charactersTable.uploadedAt)),
      db.select().from(exportsTable).orderBy(desc(exportsTable.createdAt)),
    ]);

  return {
    hooks: hookRows.map(rowToHook),
    demos: demoRows.map(rowToDemo),
    motions: motionRows.map(rowToMotion),
    music: musicRows.map(rowToMusic),
    characters: characterRows.map(rowToCharacter),
    exports: exportRows.map(rowToExport),
  };
}

/** Hooks, demos, and music only — for campaign pickers (skips heavy exports). */
export async function readLibraryPgForPickers(): Promise<LibraryData> {
  const db = getDb();
  const [hookRows, demoRows, musicRows] = await Promise.all([
    db.select().from(hooksTable).orderBy(desc(hooksTable.createdAt)),
    db.select().from(demosTable).orderBy(desc(demosTable.uploadedAt)),
    db.select().from(musicTable).orderBy(desc(musicTable.uploadedAt)),
  ]);

  return {
    hooks: hookRows.map(rowToHook),
    demos: demoRows.map(rowToDemo),
    music: musicRows.map(rowToMusic),
    motions: [],
    characters: [],
    exports: [],
  };
}

/** Library tabs — no finished exports payload. */
export async function readLibraryPgForAssets(): Promise<LibraryData> {
  const db = getDb();
  const [hookRows, demoRows, motionRows, musicRows, characterRows] =
    await Promise.all([
      db.select().from(hooksTable).orderBy(desc(hooksTable.createdAt)),
      db.select().from(demosTable).orderBy(desc(demosTable.uploadedAt)),
      db.select().from(motionsTable).orderBy(desc(motionsTable.uploadedAt)),
      db.select().from(musicTable).orderBy(desc(musicTable.uploadedAt)),
      db.select().from(charactersTable).orderBy(desc(charactersTable.uploadedAt)),
    ]);

  return {
    hooks: hookRows.map(rowToHook),
    demos: demoRows.map(rowToDemo),
    motions: motionRows.map(rowToMotion),
    music: musicRows.map(rowToMusic),
    characters: characterRows.map(rowToCharacter),
    exports: [],
  };
}

/** Finished exports only — for Instagram scheduling. */
export async function readLibraryPgForExports(): Promise<LibraryData> {
  const db = getDb();
  const exportRows = await db
    .select()
    .from(exportsTable)
    .orderBy(desc(exportsTable.createdAt));

  return {
    hooks: [],
    demos: [],
    motions: [],
    music: [],
    characters: [],
    exports: exportRows.map(rowToExport),
  };
}

/** Motions + characters — for the create hook flow. */
export async function readLibraryPgForCreate(): Promise<LibraryData> {
  const db = getDb();
  const [motionRows, characterRows] = await Promise.all([
    db.select().from(motionsTable).orderBy(desc(motionsTable.uploadedAt)),
    db.select().from(charactersTable).orderBy(desc(charactersTable.uploadedAt)),
  ]);

  return {
    hooks: [],
    demos: [],
    music: [],
    motions: motionRows.map(rowToMotion),
    characters: characterRows.map(rowToCharacter),
    exports: [],
  };
}

export async function writeLibraryPg(data: LibraryData): Promise<void> {
  const db = getDb();
  await db.delete(exportsTable);
  await db.delete(charactersTable);
  await db.delete(musicTable);
  await db.delete(motionsTable);
  await db.delete(demosTable);
  await db.delete(hooksTable);

  if (data.hooks.length) {
    await db.insert(hooksTable).values(
      data.hooks.map((hook) => ({
        id: hook.id,
        url: hook.url,
        rawUrl: hook.rawUrl,
        actionPrompt: hook.actionPrompt,
        overlayText: hook.overlayText,
        overlayStyle: hook.overlayStyle ?? null,
        characterSource: hook.characterSource,
        characterPresetId: hook.characterPresetId,
        durationSeconds: hook.durationSeconds,
        overlayBurned: hook.overlayBurned ?? false,
        sourceHookId: hook.sourceHookId,
        referenceMotionId: hook.referenceMotionId,
        campaignId: hook.campaignId,
        copiedFromHookId: hook.copiedFromHookId,
        copiedFromCampaignId: hook.copiedFromCampaignId,
        createdAt: hook.createdAt,
      })),
    );
  }

  if (data.demos.length) {
    await db.insert(demosTable).values(
      data.demos.map((demo) => ({
        id: demo.id,
        name: demo.name,
        url: demo.url,
        durationSeconds: demo.durationSeconds,
        uploadedAt: demo.uploadedAt,
      })),
    );
  }

  if (data.motions.length) {
    await db.insert(motionsTable).values(
      data.motions.map((motion) => ({
        id: motion.id,
        name: motion.name,
        url: motion.url,
        actionPrompt: motion.actionPrompt,
        durationSeconds: motion.durationSeconds,
        sourceHookId: motion.sourceHookId,
        uploadedAt: motion.uploadedAt,
      })),
    );
  }

  if (data.music.length) {
    await db.insert(musicTable).values(
      data.music.map((track) => ({
        id: track.id,
        name: track.name,
        url: track.url,
        durationSeconds: track.durationSeconds,
        uploadedAt: track.uploadedAt,
      })),
    );
  }

  if (data.characters.length) {
    await db.insert(charactersTable).values(
      data.characters.map((character) => ({
        id: character.id,
        name: character.name,
        url: character.url,
        uploadedAt: character.uploadedAt,
      })),
    );
  }

  if (data.exports.length) {
    await db.insert(exportsTable).values(
      data.exports.map((exp) => ({
        id: exp.id,
        name: exp.name,
        url: exp.url,
        hookId: exp.hookId,
        demoId: exp.demoId,
        hookUrl: exp.hookUrl,
        demoUrl: exp.demoUrl,
        hookActionPrompt: exp.hookActionPrompt,
        demoName: exp.demoName,
        overlayText: exp.overlayText,
        captionHash: exp.captionHash,
        musicId: exp.musicId,
        musicName: exp.musicName,
        musicVolume: exp.musicVolume,
        variation: exp.variation ?? null,
        runFolder: exp.runFolder,
        campaignId: exp.campaignId,
        status: exp.status,
        createdAt: exp.createdAt,
      })),
    );
  }
}

export async function addHookPg(hook: LibraryHook): Promise<LibraryHook> {
  await getDb().insert(hooksTable).values({
    id: hook.id,
    url: hook.url,
    rawUrl: hook.rawUrl,
    actionPrompt: hook.actionPrompt,
    overlayText: hook.overlayText,
    overlayStyle: hook.overlayStyle ?? null,
    characterSource: hook.characterSource,
    characterPresetId: hook.characterPresetId,
    durationSeconds: hook.durationSeconds,
    overlayBurned: hook.overlayBurned ?? false,
    sourceHookId: hook.sourceHookId,
    referenceMotionId: hook.referenceMotionId,
    campaignId: hook.campaignId,
    copiedFromHookId: hook.copiedFromHookId,
    copiedFromCampaignId: hook.copiedFromCampaignId,
    createdAt: hook.createdAt,
  });
  return hook;
}

export async function updateHookPg(hook: LibraryHook): Promise<LibraryHook> {
  await getDb()
    .update(hooksTable)
    .set({
      url: hook.url,
      rawUrl: hook.rawUrl,
      actionPrompt: hook.actionPrompt,
      overlayText: hook.overlayText,
      overlayStyle: hook.overlayStyle ?? null,
      characterSource: hook.characterSource,
      characterPresetId: hook.characterPresetId,
      durationSeconds: hook.durationSeconds,
      overlayBurned: hook.overlayBurned ?? false,
      sourceHookId: hook.sourceHookId,
      referenceMotionId: hook.referenceMotionId,
      campaignId: hook.campaignId,
      copiedFromHookId: hook.copiedFromHookId,
      copiedFromCampaignId: hook.copiedFromCampaignId,
    })
    .where(eq(hooksTable.id, hook.id));
  return hook;
}

export async function addDemoPg(demo: LibraryDemo): Promise<LibraryDemo> {
  await getDb().insert(demosTable).values({
    id: demo.id,
    name: demo.name,
    url: demo.url,
    durationSeconds: demo.durationSeconds,
    uploadedAt: demo.uploadedAt,
  });
  return demo;
}

export async function addMusicPg(track: LibraryMusic): Promise<LibraryMusic> {
  await getDb().insert(musicTable).values({
    id: track.id,
    name: track.name,
    url: track.url,
    durationSeconds: track.durationSeconds,
    uploadedAt: track.uploadedAt,
  });
  return track;
}

export async function addCharacterPg(
  character: LibraryCharacter,
): Promise<LibraryCharacter> {
  await getDb().insert(charactersTable).values({
    id: character.id,
    name: character.name,
    url: character.url,
    uploadedAt: character.uploadedAt,
  });
  return character;
}

export async function addMotionPg(motion: LibraryMotion): Promise<LibraryMotion> {
  await getDb().insert(motionsTable).values({
    id: motion.id,
    name: motion.name,
    url: motion.url,
    actionPrompt: motion.actionPrompt,
    durationSeconds: motion.durationSeconds,
    sourceHookId: motion.sourceHookId,
    uploadedAt: motion.uploadedAt,
  });
  return motion;
}

export async function addExportPg(exp: LibraryExport): Promise<LibraryExport> {
  await getDb().insert(exportsTable).values({
    id: exp.id,
    name: exp.name,
    url: exp.url,
    hookId: exp.hookId,
    demoId: exp.demoId,
    hookUrl: exp.hookUrl,
    demoUrl: exp.demoUrl,
    hookActionPrompt: exp.hookActionPrompt,
    demoName: exp.demoName,
    overlayText: exp.overlayText,
    captionHash: exp.captionHash,
    musicId: exp.musicId,
    musicName: exp.musicName,
    musicVolume: exp.musicVolume,
    variation: exp.variation ?? null,
    runFolder: exp.runFolder,
    campaignId: exp.campaignId,
    status: exp.status,
    createdAt: exp.createdAt,
  });
  return exp;
}

export async function removeLibraryItemPg(
  type: "hooks" | "demos" | "music" | "exports" | "characters" | "motions",
  id: string,
): Promise<void> {
  const db = getDb();
  if (type === "hooks") {
    await db.delete(hooksTable).where(eq(hooksTable.id, id));
  } else if (type === "demos") {
    await db.delete(demosTable).where(eq(demosTable.id, id));
  } else if (type === "music") {
    await db.delete(musicTable).where(eq(musicTable.id, id));
  } else if (type === "characters") {
    await db.delete(charactersTable).where(eq(charactersTable.id, id));
  } else if (type === "motions") {
    await db.delete(motionsTable).where(eq(motionsTable.id, id));
  } else {
    await db.delete(exportsTable).where(eq(exportsTable.id, id));
  }
}
