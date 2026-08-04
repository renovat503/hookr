import type { Campaign, LibraryMusic } from "./types";

export function isGlobalMusic(track: LibraryMusic): boolean {
  return !track.campaignId;
}

export function isCampaignMusic(
  track: LibraryMusic,
  campaignId: string,
): boolean {
  return track.campaignId === campaignId;
}

export function ownCampaignMusicTracks(
  tracks: LibraryMusic[],
  campaignId: string,
): LibraryMusic[] {
  return tracks.filter((track) => isCampaignMusic(track, campaignId));
}

/** @deprecated Global library tracks are not used for campaign audio. */
export function globalMusicTracks(tracks: LibraryMusic[]): LibraryMusic[] {
  return tracks.filter(isGlobalMusic);
}

/** @deprecated Use ownCampaignMusicTracks instead. */
export function campaignMusicTracks(
  tracks: LibraryMusic[],
  campaignId: string,
): LibraryMusic[] {
  return ownCampaignMusicTracks(tracks, campaignId);
}

export function resolveMusicBorrowSource(
  campaign: Campaign,
  campaigns: Campaign[] = [],
): Campaign | null {
  if (!campaign.borrowMusicFromCampaignId) return null;
  if (campaign.borrowMusicFromCampaignId === campaign.id) return null;
  return (
    campaigns.find((c) => c.id === campaign.borrowMusicFromCampaignId) ?? null
  );
}

export function availableCampaignMusicTracks(
  campaign: Campaign,
  tracks: LibraryMusic[],
  campaigns: Campaign[] = [],
): LibraryMusic[] {
  const own = ownCampaignMusicTracks(tracks, campaign.id);
  const borrowSource = resolveMusicBorrowSource(campaign, campaigns);
  if (!borrowSource) return own;

  const borrowed = ownCampaignMusicTracks(tracks, borrowSource.id);
  const seen = new Set(own.map((track) => track.id));
  return [...own, ...borrowed.filter((track) => !seen.has(track.id))];
}

export function isMusicAvailableForCampaign(
  track: LibraryMusic,
  campaign: Campaign,
  campaigns: Campaign[] = [],
): boolean {
  if (isCampaignMusic(track, campaign.id)) return true;
  const borrowSource = resolveMusicBorrowSource(campaign, campaigns);
  return borrowSource ? isCampaignMusic(track, borrowSource.id) : false;
}

export function pickRandomMusicId(tracks: LibraryMusic[]): string | null {
  if (!tracks.length) return null;
  return tracks[Math.floor(Math.random() * tracks.length)].id;
}

export function normalizeCampaignAudioMode(
  mode: string | undefined,
): Campaign["audioMode"] {
  if (mode === "random" || mode === "fixed") return mode;
  if (mode === "campaign") return "fixed";
  return "none";
}
