import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Search, Command, ArrowUpRight } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Input,
} from '@orbit/ui';
import type { Organization } from '@orbit/contracts';
import { searchQuerySchema } from '@orbit/contracts';
import { useGlobalSearch, searchParameters } from '../lib/discovery';
import { SearchResults } from './SearchResults';
import '../discovery.css';
export function CommandPalette({ organization }: { organization: Organization | undefined }) {
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(''),
    [debounced, setDebounced] = useState(''),
    input = useRef<HTMLInputElement>(null),
    previous = useRef<HTMLElement | null>(null),
    navigate = useNavigate();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 250);
    return () => clearTimeout(timer);
  }, [value]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (!open && document.querySelector('[role="dialog"][data-state="open"]')) return;
        event.preventDefault();
        previous.current = document.activeElement as HTMLElement;
        setOpen(!open);
        if (open) {
          setValue('');
          setDebounced('');
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);
  const parsed = searchQuerySchema.safeParse({
      q: debounced,
      ...(organization ? { organizationId: organization.id } : {}),
    }),
    query = useGlobalSearch(open && parsed.success ? parsed.data : null);
  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setValue('');
      setDebounced('');
    }
  }
  const full = () => {
    const params = searchParameters({
      q: value.trim(),
      kind: 'all',
      archived: 'false',
      ...(organization ? { organizationId: organization.id } : {}),
    });
    change(false);
    navigate(`/app/search?${params}`);
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="small"
          className="command-trigger"
          aria-label="Search and commands"
          onClick={(e) => {
            previous.current = e.currentTarget;
          }}
        >
          <Search size={18} />
          <span>Search</span>
          <kbd>
            <Command size={11} /> K
          </kbd>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="command-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          previous.current?.focus();
        }}
      >
        <DialogTitle>Find your next move.</DialogTitle>
        <DialogDescription>
          Search {organization ? organization.name : 'all your organizations'} by name or title.
          Only spaces you can access are included.
        </DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim().length >= 2) full();
          }}
        >
          <label htmlFor="command-search" className="orbit-label">
            Search your work
          </label>
          <Input
            id="command-search"
            ref={input}
            value={value}
            maxLength={120}
            placeholder="Projects, tasks, documents…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                const first = document.querySelector<HTMLAnchorElement>(
                  '.command-dialog nav[aria-label="Search results"] a',
                );
                if (first) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          />
          <Button type="submit" size="small" variant="outline" disabled={value.trim().length < 2}>
            Open full search <ArrowUpRight size={14} />
          </Button>
        </form>
        <div className="command-scroll">
          {parsed.success ? (
            <SearchResults compact query={query} onChoose={() => change(false)} />
          ) : (
            <>
              <p className="discovery-feedback">
                Enter at least two characters, or choose a destination.
              </p>
              <nav aria-label="Quick commands" className="command-destinations">
                <Link to="/app" onClick={() => change(false)}>
                  Your organizations
                </Link>
                <Link to="/app/search" onClick={() => change(false)}>
                  Search all organizations
                </Link>
                <Link to="/account" onClick={() => change(false)}>
                  Account & security
                </Link>
                <Link to="/app/preferences" onClick={() => change(false)}>
                  Notification preferences
                </Link>
                {organization && ['owner', 'admin'].includes(organization.role) ? (
                  <>
                    <Link
                      to={`/app/organizations/${organization.id}/administration`}
                      onClick={() => change(false)}
                    >
                      Administration & audit log
                    </Link>
                    <Link
                      to={`/app/organizations/${organization.id}/billing`}
                      onClick={() => change(false)}
                    >
                      Billing
                    </Link>
                  </>
                ) : null}
              </nav>
            </>
          )}
        </div>
        <p className="discovery-feedback">
          ↑ ↓ to move through results · Enter to open · Esc to close
        </p>
      </DialogContent>
    </Dialog>
  );
}
