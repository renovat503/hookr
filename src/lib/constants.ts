import type { CharacterPreset, OverlayStyle } from "./types";

export const APP_NAME = "Hookr";

export const DEFAULT_MUSIC_VOLUME = 85;

export const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    id: "char-1",
    tagline: "Energetic creator",
    imageUrl: "/characters/char-1.jpg?v=3",
  },
  {
    id: "char-2",
    tagline: "Calm explainer",
    imageUrl: "/characters/char-2.jpg?v=3",
  },
  {
    id: "char-3",
    tagline: "Bold storyteller",
    imageUrl: "/characters/char-3.jpg?v=3",
  },
  {
    id: "char-4",
    tagline: "Hype reaction",
    imageUrl: "/characters/char-4.jpg?v=3",
  },
];

export const ACTION_PROMPTS = [
  "Laughing happily with hand over the mouth continuously",
  "Nodding excitedly and smiling",
  "Pointing at the camera with wide eyes",
  "Gasping in surprise then grinning",
  "Waving both hands enthusiastically",
];

export const DEFAULT_OVERLAY_STYLE: OverlayStyle = {
  fontFamily: "impact",
  fontSize: 48,
  align: "center",
  italic: false,
  uppercase: false,
  textColor: "#FFFFFF",
  borderWidth: 3,
  borderColor: "#000000",
  bold: true,
  highlight: true,
  layout: "caption-bottom",
};

export const BORDER_WIDTH_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12];

export const BORDER_COLOR_OPTIONS = [
  "#000000",
  "#FFFFFF",
  "#FFE100",
  "#FF5C5C",
  "#5EC8FF",
  "#D4FF3F",
];

export const TEXT_COLOR_OPTIONS = [
  "#FFFFFF",
  "#000000",
  "#FFE100",
  "#FF5C5C",
  "#5EC8FF",
  "#D4FF3F",
];

export const FONT_OPTIONS = [
  { id: "impact" as const, label: "Impact" },
  { id: "arial" as const, label: "Arial" },
  { id: "arial-black" as const, label: "Arial Black" },
  { id: "helvetica" as const, label: "Helvetica" },
  { id: "georgia" as const, label: "Georgia" },
  { id: "times" as const, label: "Times" },
  { id: "courier" as const, label: "Courier" },
  { id: "rounded" as const, label: "Rounded" },
  { id: "bricolage-grotesque" as const, label: "Bricolage Grotesque" },
];

export const FONT_SIZE_OPTIONS = [32, 36, 40, 44, 48, 52, 56, 60, 64, 72];

export const LAYOUT_OPTIONS = [
  { id: "center" as const, label: "Center" },
  { id: "caption-top" as const, label: "Top" },
  { id: "caption-bottom" as const, label: "Bottom" },
];

export const ALIGN_OPTIONS = [
  { id: "left" as const, label: "Left", icon: "left" },
  { id: "center" as const, label: "Center", icon: "center" },
  { id: "right" as const, label: "Right", icon: "right" },
];

export const DEFAULT_TEXT_OVERLAYS = [
  "Wait for this trick…",
  "Stop scrolling if you're still doing this wrong",
  "Nobody talks about this hack",
  "This changed everything for me",
  "Watch before it's gone",
];

export const OVERLAY_EMOJIS = [
  "🔥",
  "👀",
  "💰",
  "💸",
  "💵",
  "🤑",
  "🪙",
  "💳",
  "📈",
  "📊",
  "💹",
  "🚀",
  "💎",
  "💯",
  "✅",
  "🎉",
  "🏷️",
  "⏰",
  "🛒",
  "📣",
  "✨",
  "👇",
  "🎯",
  "⚡",
  "💡",
  "😱",
  "🛑",
  "🆓",
  "⬆️",
  "🔑",
  "🧾",
  "🏦",
  "💼",
  "🎁",
  "🔔",
  "🛍️",
  "🏆",
  "💲",
];
