import { Moon, Sun, Monitor } from 'lucide-react';
import { Tooltip } from '@orbit/ui';
import { useUI } from '../state/ui';

export function ThemeControl() {
  const theme = useUI((state) => state.theme);
  const setTheme = useUI((state) => state.setTheme);
  return (
    <div className="theme-switcher" role="group" aria-label="Appearance">
      {(
        [
          { value: 'light', label: 'Light theme', icon: Sun },
          { value: 'dark', label: 'Dark theme', icon: Moon },
          { value: 'system', label: 'System theme', icon: Monitor },
        ] as const
      ).map((option) => (
        <Tooltip key={option.value} content={option.label}>
          <button
            aria-label={option.label}
            aria-pressed={theme === option.value}
            onClick={() => setTheme(option.value)}
          >
            <option.icon size={14} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
