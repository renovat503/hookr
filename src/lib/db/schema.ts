import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type {
  CampaignAudioMode,
  CampaignBorrowAssetKind,
  CampaignStatus,
  CharacterSource,
  ExportVariation,
  OverlayStyle,
} from "@/lib/types";

export const captions = pgTable("captions", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey().default("default"),
  referenceMotionId: text("reference_motion_id"),
});

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").$type<CampaignStatus>().notNull().default("open"),
  hookIds: jsonb("hook_ids").$type<string[]>().notNull().default([]),
  demoIds: jsonb("demo_ids").$type<string[]>().notNull().default([]),
  captionIds: jsonb("caption_ids").$type<string[]>().notNull().default([]),
  useCaptions: boolean("use_captions").notNull().default(false),
  audioMode: text("audio_mode").$type<CampaignAudioMode>().notNull().default("none"),
  musicId: text("music_id"),
  musicVolume: integer("music_volume").notNull().default(85),
  randomFormat: boolean("random_format").notNull().default(true),
  borrowFromCampaignId: text("borrow_from_campaign_id"),
  borrowAssetKind: text("borrow_asset_kind").$type<CampaignBorrowAssetKind | null>(),
  copiedFromCampaignId: text("copied_from_campaign_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const hooks = pgTable("hooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  rawUrl: text("raw_url"),
  actionPrompt: text("action_prompt").notNull().default(""),
  overlayText: text("overlay_text").notNull().default(""),
  overlayStyle: jsonb("overlay_style").$type<OverlayStyle | null>(),
  characterSource: text("character_source").$type<CharacterSource>().notNull(),
  characterPresetId: text("character_preset_id"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  overlayBurned: boolean("overlay_burned").notNull().default(false),
  sourceHookId: text("source_hook_id"),
  referenceMotionId: text("reference_motion_id"),
  campaignId: text("campaign_id"),
  copiedFromHookId: text("copied_from_hook_id"),
  copiedFromCampaignId: text("copied_from_campaign_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const demos = pgTable("demos", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const motions = pgTable("motions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  actionPrompt: text("action_prompt").notNull().default(""),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  sourceHookId: text("source_hook_id"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const music = pgTable("music", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const characters = pgTable("characters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const exportsTable = pgTable("exports", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  hookId: text("hook_id"),
  demoId: text("demo_id"),
  hookUrl: text("hook_url").notNull().default(""),
  demoUrl: text("demo_url").notNull().default(""),
  hookActionPrompt: text("hook_action_prompt").notNull().default(""),
  demoName: text("demo_name").notNull().default(""),
  overlayText: text("overlay_text").notNull().default(""),
  captionHash: text("caption_hash"),
  musicId: text("music_id"),
  musicName: text("music_name"),
  musicVolume: integer("music_volume"),
  variation: jsonb("variation").$type<ExportVariation | null>(),
  runFolder: text("run_folder"),
  campaignId: text("campaign_id"),
  status: text("status").$type<"ready" | "preview">().notNull().default("ready"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const instagramAccounts = pgTable("instagram_accounts", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id"),
  igUserId: text("ig_user_id").notNull(),
  username: text("username").notNull(),
  profilePictureUrl: text("profile_picture_url"),
  pageId: text("page_id").notNull(),
  pageName: text("page_name").notNull(),
  accessToken: text("access_token").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  tokenExpiresAt: timestamp("token_expires_at", {
    withTimezone: true,
    mode: "string",
  }),
});

export const scheduledPosts = pgTable("scheduled_posts", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id"),
  accountId: text("account_id").notNull(),
  exportId: text("export_id").notNull(),
  exportName: text("export_name"),
  caption: text("caption").notNull().default(""),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "string" })
    .notNull(),
  status: text("status").notNull(),
  source: text("source").$type<"manual" | "queue" | "auto">().notNull().default("manual"),
  queuePosition: integer("queue_position"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
  publishedMediaId: text("published_media_id"),
  error: text("error"),
});

export const instagramMeta = pgTable("instagram_meta", {
  id: text("id").primaryKey().default("default"),
  publishedExportIds: jsonb("published_export_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  accountLastPublishedAt: jsonb("account_last_published_at")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  autoPostEnabled: boolean("auto_post_enabled").notNull().default(true),
  autoPostIntervalHours: integer("auto_post_interval_hours").notNull().default(5),
  accountPostingGoals: jsonb("account_posting_goals")
    .$type<Record<string, { postsPerDay: number; slotTimes: string[] }>>()
    .notNull()
    .default({}),
  apiRateLimitedUntil: timestamp("api_rate_limited_until", {
    withTimezone: true,
    mode: "string",
  }),
});

export const youtubeAccounts = pgTable("youtube_accounts", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id"),
  channelId: text("channel_id").notNull(),
  channelTitle: text("channel_title").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  connectedAt: timestamp("connected_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  tokenExpiresAt: timestamp("token_expires_at", {
    withTimezone: true,
    mode: "string",
  }),
});

export const youtubeScheduledPosts = pgTable("youtube_scheduled_posts", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id"),
  accountId: text("account_id").notNull(),
  exportId: text("export_id").notNull(),
  exportName: text("export_name"),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "string" })
    .notNull(),
  status: text("status").notNull(),
  source: text("source").$type<"manual" | "queue" | "auto">().notNull().default("manual"),
  queuePosition: integer("queue_position"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
  youtubeVideoId: text("youtube_video_id"),
  error: text("error"),
});

export const youtubeMeta = pgTable("youtube_meta", {
  id: text("id").primaryKey().default("default"),
  publishedExportIds: jsonb("published_export_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  accountLastPublishedAt: jsonb("account_last_published_at")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  accountPostingGoals: jsonb("account_posting_goals")
    .$type<Record<string, { postsPerDay: number; slotTimes: string[] }>>()
    .notNull()
    .default({}),
  quotaExhaustedUntil: timestamp("quota_exhausted_until", {
    withTimezone: true,
    mode: "string",
  }),
});
