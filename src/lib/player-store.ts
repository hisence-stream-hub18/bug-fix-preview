// Tiny global store for the floating player popup. Lives outside React so any
// page (library, playlist, downloads, channels, devices) can open the player and
// keep it visible while the user navigates.

import { useEffect, useState } from "react";
import type { TvDevice } from "./ums-store";
import { getUms } from "./ums-bridge";

/** While anything is playing on the TV the desktop speakers must stay silent. */
function muteDesktop(on: boolean) {
  const api = getUms();
  void api?.screenMuteLocal?.(on)?.catch?.(() => null);
}

export type PlayerSession = {
  device: TvDevice;
  title: string;
  /** Live desktop mirroring session (no seek bar). */
  live?: boolean;
};

type PlayerState = {
  session: PlayerSession | null;
  minimized: boolean;
  buffering: boolean;
};

let state: PlayerState = { session: null, minimized: false, buffering: false };
const listeners = new Set<(s: PlayerState) => void>();

function set(next: Partial<PlayerState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
}

export function openPlayer(session: PlayerSession) {
  muteDesktop(true);
  set({ session, minimized: false, buffering: false });
}

export function updatePlayer(patch: Partial<PlayerSession>) {
  if (!state.session) return;
  set({ session: { ...state.session, ...patch } });
}

export function closePlayer() {
  muteDesktop(false);
  set({ session: null, minimized: false, buffering: false });
}

export const minimizePlayer = (minimized: boolean) => set({ minimized });
export const setBuffering = (buffering: boolean) => set({ buffering });

// ---------------------------------------------------------------- in-app player
// The built-in player (next to "share to TV"): plays HLS/IPTV, direct video
// links, local files and YouTube inside the app window.

export type InAppSource = {
  title: string;
  /** Original link or local file path. */
  source: string;
  /** Registered media id, when the item already lives in the registry. */
  mediaId?: string;
};

let inApp: InAppSource | null = null;
const inAppListeners = new Set<(s: InAppSource | null) => void>();

export function openInAppPlayer(item: InAppSource) {
  inApp = item;
  inAppListeners.forEach((l) => l(inApp));
}

export function closeInAppPlayer() {
  inApp = null;
  inAppListeners.forEach((l) => l(inApp));
}

export function useInAppPlayer() {
  const [value, setValue] = useState(inApp);
  useEffect(() => {
    inAppListeners.add(setValue);
    setValue(inApp);
    return () => {
      inAppListeners.delete(setValue);
    };
  }, []);
  return value;
}

export function usePlayerSession() {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    setValue(state);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
