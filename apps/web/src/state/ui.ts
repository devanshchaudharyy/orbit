import { create } from 'zustand';
import type { ThemePreference } from '@orbit/contracts';

function initialTheme(): ThemePreference {
  try {
    const theme = localStorage.getItem('orbit.theme.v1');
    if (theme === 'light' || theme === 'system') return theme;
  } catch {
    /* Storage is optional. */
  }
  return 'dark';
}
export const useUI = create<{
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}>((set) => ({
  theme: initialTheme(),
  setTheme(theme) {
    try {
      localStorage.setItem('orbit.theme.v1', theme);
    } catch {
      /* Retain in-memory preference. */
    }
    set({ theme });
  },
  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
}));
