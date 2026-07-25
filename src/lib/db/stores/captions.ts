import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { captions as captionsTable } from "@/lib/db/schema";
import type { LibraryCaption } from "@/lib/types";

function rowToCaption(row: typeof captionsTable.$inferSelect): LibraryCaption {
  return {
    id: row.id,
    text: row.text,
    tags: row.tags ?? [],
    createdAt: row.createdAt,
  };
}

export async function readCaptionsPg(): Promise<LibraryCaption[]> {
  const rows = await getDb()
    .select()
    .from(captionsTable)
    .orderBy(asc(captionsTable.createdAt));
  return rows.map(rowToCaption);
}

export async function writeCaptionsPg(captions: LibraryCaption[]): Promise<void> {
  const db = getDb();
  await db.delete(captionsTable);
  if (!captions.length) return;
  await db.insert(captionsTable).values(
    captions.map((caption) => ({
      id: caption.id,
      text: caption.text,
      tags: caption.tags,
      createdAt: caption.createdAt,
    })),
  );
}

export async function addCaptionsPg(
  items: LibraryCaption[],
): Promise<LibraryCaption[]> {
  if (!items.length) return [];
  await getDb()
    .insert(captionsTable)
    .values(
      items.map((caption) => ({
        id: caption.id,
        text: caption.text,
        tags: caption.tags,
        createdAt: caption.createdAt,
      })),
    )
    .onConflictDoNothing();
  return items;
}

export async function removeCaptionPg(id: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(captionsTable)
    .where(eq(captionsTable.id, id))
    .returning({ id: captionsTable.id });
  return deleted.length > 0;
}

export async function updateCaptionPg(
  id: string,
  text: string,
): Promise<LibraryCaption | null> {
  const updated = await getDb()
    .update(captionsTable)
    .set({ text })
    .where(eq(captionsTable.id, id))
    .returning();
  const row = updated[0];
  return row ? rowToCaption(row) : null;
}
