import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { appSettings as appSettingsTable } from "@/lib/db/schema";
import type { AppSettings } from "@/lib/types";

const DEFAULT_ID = "default";

export async function readAppSettingsPg(): Promise<AppSettings> {
  const row = await getDb()
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, DEFAULT_ID))
    .limit(1);
  const current = row[0];
  return {
    referenceMotionId: current?.referenceMotionId ?? null,
  };
}

export async function updateAppSettingsPg(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await readAppSettingsPg();
  const next: AppSettings = {
    ...current,
    ...patch,
    referenceMotionId:
      patch.referenceMotionId !== undefined
        ? patch.referenceMotionId
        : current.referenceMotionId,
  };

  await getDb()
    .insert(appSettingsTable)
    .values({
      id: DEFAULT_ID,
      referenceMotionId: next.referenceMotionId,
    })
    .onConflictDoUpdate({
      target: appSettingsTable.id,
      set: { referenceMotionId: next.referenceMotionId },
    });

  return next;
}
