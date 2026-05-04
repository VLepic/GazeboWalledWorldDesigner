import type { Preview3DState } from "../store/editor-ui-store";

export const PREVIEW_WINDOW_HASH = "#/preview-3d";
export const PREVIEW_SYNC_CHANNEL = "wawod-studio-preview";
export const PREVIEW_SNAPSHOT_STORAGE_KEY = "wawod-studio-preview-snapshot";

export interface PreviewWindowSnapshot {
  projectJson: string;
  preview3D: Preview3DState;
  hiddenLevelIds3D: string[];
  updatedAtIso: string;
}

export interface PreviewSnapshotMessage {
  type: "project-snapshot";
  sourceId: string;
  snapshot: PreviewWindowSnapshot;
}

export interface PreviewSnapshotRequestMessage {
  type: "request-project-snapshot";
  sourceId: string;
}

export type PreviewWindowMessage = PreviewSnapshotMessage | PreviewSnapshotRequestMessage;

export function createPreviewWindowUrl(currentUrl: string) {
  const url = new URL(currentUrl);
  url.hash = PREVIEW_WINDOW_HASH;
  return url.toString();
}

export function isPreviewWindowHash(hash: string) {
  return hash === PREVIEW_WINDOW_HASH;
}

export function createPreviewWindowSnapshot(
  projectJson: string,
  preview3D: Preview3DState,
  hiddenLevelIds3D: string[],
): PreviewWindowSnapshot {
  return {
    projectJson,
    preview3D: { ...preview3D },
    hiddenLevelIds3D: [...hiddenLevelIds3D],
    updatedAtIso: new Date().toISOString(),
  };
}

export function writePreviewWindowSnapshot(snapshot: PreviewWindowSnapshot) {
  window.localStorage.setItem(PREVIEW_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
}

export function readPreviewWindowSnapshot() {
  const rawValue = window.localStorage.getItem(PREVIEW_SNAPSHOT_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PreviewWindowSnapshot>;
    if (
      typeof parsed.projectJson !== "string" ||
      typeof parsed.updatedAtIso !== "string" ||
      parsed.preview3D === undefined ||
      !Array.isArray(parsed.hiddenLevelIds3D)
    ) {
      return null;
    }

    return parsed as PreviewWindowSnapshot;
  } catch {
    return null;
  }
}
