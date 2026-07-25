export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function formatDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

export type CalendarDay = {
  date: Date;
  inMonth: boolean;
  iso: string;
};

/** Six-row month grid starting on Sunday. */
export function getMonthGrid(month: Date): CalendarDay[] {
  const first = startOfMonth(month);
  const cursor = new Date(first);
  cursor.setDate(cursor.getDate() - cursor.getDay());

  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() + i);
    days.push({
      date,
      inMonth: date.getMonth() === month.getMonth(),
      iso: formatDateIso(date),
    });
  }
  return days;
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTimeInputValue(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function combineDateAndTime(dateIso: string, time: string): Date {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  const date = new Date(`${dateIso}T00:00:00`);
  date.setHours(hours, minutes ?? 0, 0, 0);
  return date;
}

export function defaultScheduleTime(): string {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  if (next.getHours() < 6) {
    next.setHours(9, 0, 0, 0);
  }
  return formatTimeInputValue(next.toISOString());
}

/** Keep the post's clock time, move it to another calendar day. */
export function moveScheduledTimeToDate(
  scheduledAtIso: string,
  targetDate: Date,
): Date {
  const current = new Date(scheduledAtIso);
  return new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    current.getHours(),
    current.getMinutes(),
    0,
    0,
  );
}

/** Pick a future datetime on a given day (for queue → calendar drops). */
export function defaultScheduleDateTime(targetDate: Date): Date {
  let result = combineDateAndTime(formatDateIso(targetDate), defaultScheduleTime());
  const minTime = Date.now() + 60_000;
  if (result.getTime() >= minTime) return result;

  if (isSameDay(targetDate, new Date())) {
    const bump = new Date();
    bump.setMinutes(0, 0, 0);
    bump.setHours(bump.getHours() + 1);
    result = combineDateAndTime(
      formatDateIso(targetDate),
      formatTimeInputValue(bump.toISOString()),
    );
  } else {
    result = combineDateAndTime(formatDateIso(targetDate), "09:00");
  }
  return result;
}

export const DRAG_POST_MIME = "application/x-hookr-post-id";
export const DRAG_QUEUE_MIME = "application/x-hookr-queue-id";
