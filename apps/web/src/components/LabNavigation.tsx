import { useEffect, useRef, useState } from 'react';
import {
  Blocks,
  Palette,
  Type,
  Layers3,
  SlidersHorizontal,
  Activity,
  Search,
  ArrowUpRight,
  Command,
} from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@orbit/ui';
import { useUI } from '../state/ui';

export const labSections = [
  { id: 'overview', label: 'Overview', icon: Layers3, group: 'FOUNDATIONS' },
  { id: 'colors', label: 'Color palette', icon: Palette, group: 'FOUNDATIONS' },
  { id: 'typography', label: 'Typography', icon: Type, group: 'FOUNDATIONS' },
  { id: 'components', label: 'Components', icon: Blocks, group: 'BUILDING BLOCKS' },
  { id: 'patterns', label: 'States & patterns', icon: SlidersHorizontal, group: 'BUILDING BLOCKS' },
  { id: 'system', label: 'System status', icon: Activity, group: 'DEVELOPMENT' },
];

export function Sidebar({ active, navigate }: { active: string; navigate?: () => void }) {
  const setCommandOpen = useUI((state) => state.setCommandOpen);
  return (
    <div className="sidebar-inner">
      <a className="brand" href="/" aria-label="ORBIT home">
        <img src="/orbit.svg" alt="" width="32" height="32" />
        <span>
          orbit<span className="brand-dot">.</span>
        </span>
        <span className="brand-version">LAB</span>
      </a>
      <button className="sidebar-search" onClick={() => setCommandOpen(true)}>
        <Search size={14} />
        <span>Find a component</span>
        <kbd>⌘ K</kbd>
      </button>
      <nav aria-label="Design system sections">
        {labSections.map((item, index) => (
          <div key={item.id}>
            {index === 0 || item.group !== labSections[index - 1]?.group ? (
              <p className="nav-group">{item.group}</p>
            ) : null}
            <a
              href={`#${item.id}`}
              className={`nav-item ${active === item.id ? 'active' : ''}`}
              aria-current={active === item.id ? 'location' : undefined}
              onClick={navigate}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
              {item.id === 'components' ? <span className="nav-count">UI</span> : null}
            </a>
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="foundation-note">
          <span className="small-orbit">✧</span>
          <p>
            A foundation for
            <br />
            <strong>what comes next.</strong>
          </p>
          <a href="#system" onClick={navigate}>
            Explore the foundation <ArrowUpRight size={13} />
          </a>
        </div>
        <div className="environment-label">
          <span className="environment-dot" />
          <span>Local development</span>
          <span className="phase-label">PHASE 0</span>
        </div>
      </div>
    </div>
  );
}

export { ThemeControl } from './ThemeControl';

export function CommandPalette() {
  const open = useUI((state) => state.commandOpen);
  const setOpen = useUI((state) => state.setCommandOpen);
  const [search, setSearch] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const destination = useRef<string | null>(null);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearch('');
        setOpen(!useUI.getState().commandOpen);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [setOpen]);
  const filtered = labSections.filter((section) =>
    section.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="command-dialog"
        onCloseAutoFocus={(event) => {
          if (destination.current) {
            event.preventDefault();
            document.getElementById(destination.current)?.focus();
            destination.current = null;
          }
        }}
      >
        <DialogTitle>
          <Command size={18} /> Jump to a section
        </DialogTitle>
        <DialogDescription>Search the ORBIT design system.</DialogDescription>
        <Input
          aria-label="Search sections"
          placeholder="Search components, tokens, patterns…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              list.current?.querySelector<HTMLButtonElement>('button')?.focus();
            }
          }}
        />
        <div
          ref={list}
          className="command-results"
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const buttons = Array.from(
              list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
            );
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
          }}
        >
          {filtered.length ? (
            filtered.map((section) => (
              <Button
                key={section.id}
                variant="ghost"
                onClick={() => {
                  destination.current = section.id;
                  window.location.hash = section.id;
                  setOpen(false);
                }}
              >
                <section.icon size={15} />
                <span>{section.label}</span>
                <ArrowUpRight size={13} />
              </Button>
            ))
          ) : (
            <p className="muted">No matching sections. Try “colors” or “system”.</p>
          )}
        </div>
        <div className="command-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to navigate
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
