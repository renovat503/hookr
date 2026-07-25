export type WorkflowStep = "hook" | "demo" | "export";

export type CharacterSource = "upload" | "preset" | "library";

export type OverlayFontFamily =
  | "impact"
  | "arial"
  | "arial-black"
  | "helvetica"
  | "georgia"
  | "times"
  | "courier"
  | "rounded"
  | "bricolage-grotesque";

export type OverlayStyle = {
  fontFamily: OverlayFontFamily;
  fontSize: number;
  align: "left" | "center" | "right";
  italic: boolean;
  uppercase: boolean;
  textColor: string;
  /** Text outline / stroke width in pixels (0 = none) */
  borderWidth: number;
  /** Text outline / stroke color */
  borderColor: string;
  bold: boolean;
  highlight: boolean;
  layout: "center" | "caption-top" | "caption-bottom";
  /** Custom placement as % of 1080×1920 frame (center anchor). When set, overrides layout presets. */
  positionX?: number | null;
  positionY?: number | null;
};

export type HookConfig = {
  characterSource: CharacterSource;
  characterPresetId: string | null;
  libraryHookId: string | null;
  uploadedImageUrl: string | null;
  uploadedImageName: string | null;
  /** Saved character photo from the library (upload tab / characters grid) */
  characterLibraryId: string | null;
  actionPrompt: string;
  overlayText: string;
  overlayStyle: OverlayStyle;
  generatedClipUrl: string | null;
  /** Caption-free hook video — used when editing overlay after generation */
  generatedRawClipUrl: string | null;
  /** Library hook id for the current generated / selected clip */
  generatedHookId: string | null;
  /** Motion clip id before caption is applied */
  generatedMotionId: string | null;
  /** Overlay baked into generatedClipUrl; when current overlay differs, preview switches to raw + live caption */
  generatedOverlaySnapshot: { text: string; style: OverlayStyle } | null;
  isGenerating: boolean;
  generationError: string | null;
  /** Non-fatal notice after successful generation (e.g. likeness fallback) */
  generationNotice: string | null;
};

export type DemoClip = {
  id: string;
  name: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  url: string | null;
  uploadedAt: string;
};

export type ProjectState = {
  step: WorkflowStep;
  hook: HookConfig;
  selectedDemoId: string | null;
  demoClips: DemoClip[];
};

export type CharacterPreset = {
  id: string;
  tagline: string;
  imageUrl: string;
};

export type LibraryCharacter = {
  id: string;
  name: string;
  url: string;
  uploadedAt: string;
};

export type LibraryHook = {
  id: string;
  url: string;
  /** Caption-free source video for re-applying text without regenerating */
  rawUrl?: string | null;
  actionPrompt: string;
  overlayText: string;
  overlayStyle?: OverlayStyle;
  characterSource: CharacterSource;
  characterPresetId: string | null;
  durationSeconds: number;
  overlayBurned?: boolean;
  sourceHookId?: string | null;
  /** Motion library clip whose action guided this generation */
  referenceMotionId?: string | null;
  /** Campaign that owns this hook */
  campaignId?: string | null;
  /** Set when this hook was copied from another campaign's hook */
  copiedFromHookId?: string | null;
  copiedFromCampaignId?: string | null;
  createdAt: string;
};

export type LibraryMotion = {
  id: string;
  name: string;
  url: string;
  actionPrompt: string;
  durationSeconds: number;
  /** Hook this motion was saved from, if any */
  sourceHookId?: string | null;
  uploadedAt: string;
};

export type LibraryDemo = {
  id: string;
  name: string;
  url: string;
  durationSeconds: number;
  uploadedAt: string;
};

export type LibraryMusic = {
  id: string;
  name: string;
  url: string;
  durationSeconds: number;
  uploadedAt: string;
};

export type ExportVariation = {
  seed: number;
  speed: number;
  trimStartMs: number;
  trimEndMs: number;
  musicStartOffsetSec?: number;
};

export type LibraryCaption = {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
};

export type CampaignAudioMode = "none" | "random" | "fixed";

export type CampaignBorrowAssetKind = "hooks" | "demos";

export type CampaignStatus = "open" | "closed";

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  hookIds: string[];
  demoIds: string[];
  captionIds: string[];
  useCaptions: boolean;
  audioMode: CampaignAudioMode;
  musicId: string | null;
  musicVolume: number;
  randomFormat: boolean;
  /** Mirror hook or demo selection from another campaign (never both). */
  borrowFromCampaignId?: string | null;
  borrowAssetKind?: CampaignBorrowAssetKind | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignsData = {
  campaigns: Campaign[];
};

export type AppSettings = {
  /** Application-wide default motion for hook generation */
  referenceMotionId: string | null;
};

export type LibraryExport = {
  id: string;
  name: string;
  url: string;
  hookId?: string | null;
  demoId?: string | null;
  hookUrl: string;
  demoUrl: string;
  hookActionPrompt: string;
  demoName: string;
  overlayText: string;
  /** Stable hash of normalized overlayText for dedup */
  captionHash?: string | null;
  musicId?: string | null;
  musicName?: string | null;
  musicVolume?: number | null;
  variation?: ExportVariation | null;
  /** Production run folder name under public/exports/runs/ */
  runFolder?: string | null;
  /** Campaign that produced this export */
  campaignId?: string | null;
  status: "ready" | "preview";
  createdAt: string;
};

export type LibraryData = {
  hooks: LibraryHook[];
  demos: LibraryDemo[];
  music: LibraryMusic[];
  exports: LibraryExport[];
  characters: LibraryCharacter[];
  motions: LibraryMotion[];
};

export type InstagramAccount = {
  id: string;
  /** Instagram professional user id */
  igUserId: string;
  username: string;
  profilePictureUrl?: string | null;
  pageId: string;
  pageName: string;
  /** Long-lived Page access token used for publishing */
  accessToken: string;
  connectedAt: string;
  tokenExpiresAt?: string | null;
};

export type ScheduledPostSource = "manual" | "queue" | "auto";

export type ScheduledPostStatus =
  | "queued"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export type ScheduledPost = {
  id: string;
  accountId: string;
  exportId: string;
  /** Snapshot for history after the export leaves the selectable list */
  exportName?: string;
  caption: string;
  scheduledAt: string;
  status: ScheduledPostStatus;
  source?: ScheduledPostSource;
  /** Order within an account queue (lower = publishes first) */
  queuePosition?: number | null;
  createdAt: string;
  publishedAt?: string | null;
  publishedMediaId?: string | null;
  error?: string | null;
};

export type InstagramData = {
  accounts: InstagramAccount[];
  scheduledPosts: ScheduledPost[];
  /** Export IDs that have been published to Instagram — never selectable again */
  publishedExportIds: string[];
  /** Per-account ISO timestamp of last successful publish (manual or auto) */
  accountLastPublishedAt: Record<string, string>;
  /** When true, eligible accounts auto-publish oldest videos on a fixed interval */
  autoPostEnabled: boolean;
  /** Hours between auto-posts per account (4, 5, or 6) */
  autoPostIntervalHours: 4 | 5 | 6;
  /** Skip Instagram API calls until this time after a rate-limit error (ISO) */
  apiRateLimitedUntil?: string | null;
};
