import { useEffect, type ReactNode } from 'react';
import { useUI } from '../state/ui';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUI((state) => state.theme);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return children;
}
