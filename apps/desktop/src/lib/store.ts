import { create } from "zustand";

export type Theme = "light" | "dark";

const THEME_KEY = "ai4s.theme";
const SIDEBAR_WIDTH_KEY = "ai4s.sidebar.width";
const SIDEBAR_COLLAPSED_KEY = "ai4s.sidebar.collapsed";

export const SIDEBAR_MIN = 184;
export const SIDEBAR_MAX = 340;
export const SIDEBAR_DEFAULT = 232;

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function initialSidebarWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT;
  const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (!Number.isFinite(saved) || saved === 0) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, saved));
}

interface UiState {
  theme: Theme;
  inspectorOpen: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  paletteOpen: boolean;
  /** One-shot text placed into the composer by another surface (e.g. the
   *  provenance Reproduce action) — consumed on the next composer render. */
  composerDraft: string | null;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setInspectorOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setPaletteOpen: (open: boolean) => void;
  setComposerDraft: (draft: string | null) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: initialTheme(),
  inspectorOpen: true,
  sidebarCollapsed:
    typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
  sidebarWidth: initialSidebarWidth(),
  paletteOpen: false,
  setTheme: (theme) => {
    if (typeof window !== "undefined") window.localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "light" ? "dark" : "light"),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => {
    if (typeof window !== "undefined")
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    set({ sidebarCollapsed });
  },
  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
  setSidebarWidth: (width) => {
    const sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
    if (typeof window !== "undefined")
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    set({ sidebarWidth });
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  composerDraft: null,
  setComposerDraft: (composerDraft) => set({ composerDraft }),
}));
