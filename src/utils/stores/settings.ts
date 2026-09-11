import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { Settings } from "@/config/settings";
import { getSettingsValues } from "@/config/settings";

const settings = getSettingsValues();

// Keys that are persisted server-side (instance-wide).
const SERVER_SYNCED_KEYS: (keyof Settings)[] = ["resizerHost"];

export interface SettingsState {
  settings: Settings;
  serverLoaded: boolean;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  updateSettings: (newSettings: Partial<Settings>) => void;
  resetSettings: () => void;
  loadServerSettings: () => Promise<void>;
}

async function fetchServerThumbnailSettings(): Promise<Partial<Settings>> {
  try {
    const res = await fetch("/api/settings/thumbnail");
    if (!res.ok) return {};
    const data = await res.json();
    const result: Partial<Settings> = {};
    if (data.resizerHost !== undefined) result.resizerHost = data.resizerHost;
    return result;
  } catch {
    return {};
  }
}

async function saveServerThumbnailSettings(settings: Settings): Promise<void> {
  try {
    await fetch("/api/settings/thumbnail", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resizerHost: settings.resizerHost || "",
        resizerWidth: 360,
        resizerQuality: 80,
      }),
    });
  } catch {
    // silently fail - localStorage still has the value
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    immer((set, get) => ({
      settings,
      serverLoaded: false,
      updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => {
        set((state) => {
          state.settings[key] = value;
        });
        // If this is a server-synced key, push to server
        if (SERVER_SYNCED_KEYS.includes(key)) {
          const updated = { ...get().settings, [key]: value };
          saveServerThumbnailSettings(updated as Settings);
        }
      },
      updateSettings: (newSettings) => {
        set((state) => {
          Object.assign(state.settings, newSettings);
        });
        // Check if any server-synced keys changed
        const hasServerKey = Object.keys(newSettings).some((k) =>
          SERVER_SYNCED_KEYS.includes(k as keyof Settings),
        );
        if (hasServerKey) {
          saveServerThumbnailSettings(get().settings);
        }
      },
      resetSettings: () =>
        set((state) => {
          state.settings = { ...settings };
        }),
      loadServerSettings: async () => {
        const serverSettings = await fetchServerThumbnailSettings();
        if (Object.keys(serverSettings).length > 0) {
          set((state) => {
            // Server values take priority for synced keys
            for (const key of SERVER_SYNCED_KEYS) {
              if (key in serverSettings) {
                (state.settings as any)[key] = (serverSettings as any)[key];
              }
            }
            state.serverLoaded = true;
          });
        } else {
          set((state) => {
            state.serverLoaded = true;
          });
        }
      },
    })),
    {
      name: "bdrive-settings",
      merge: (persistedState: any, currentState) => {
        const defaultSettings = getSettingsValues();
        const mergedSettings = { ...defaultSettings };

        if (persistedState && typeof persistedState.settings === "object") {
          for (const key in persistedState.settings) {
            const value = persistedState.settings[key];
            if (value !== undefined && value !== null && value !== "") {
              mergedSettings[key as keyof Settings] = value;
            }
          }
        }

        return {
          ...currentState,
          settings: mergedSettings,
        };
      },
    },
  ),
);

// Auto-load server settings on module init
useSettingsStore.getState().loadServerSettings();
