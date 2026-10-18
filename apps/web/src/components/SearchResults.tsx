import { Link } from 'react-router';
import {
  ArrowUpRight,
  FileText,
  Search,
  Folder,
  CheckSquare,
  Building2,
  Paperclip,
} from 'lucide-react';
import { Button } from '@orbit/ui';
import type { z } from 'zod';
import type { searchResultSchema } from '@orbit/contracts';
import { useGlobalSearch } from '../lib/discovery';
import { StatusNotice } from './AuthLayout';
import { authErrorMessage } from '../lib/auth';
export function SearchResults({
  query,
  onChoose,
  compact = false,
}: {
  query: ReturnType<typeof useGlobalSearch>;
  onChoose?: () => void;
  compact?: boolean;
}) {
  const rows = query.data?.pages.flatMap((p) => p.results) ?? [];
  if (query.isError)
    return (
      <StatusNotice>
        {authErrorMessage(query.error)}{' '}
        <Button size="small" variant="outline" onClick={() => void query.refetch()}>
          Retry search
        </Button>
      </StatusNotice>
    );
  if (query.isPending)
    return (
      <p role="status" className="discovery-feedback">
        Searching your authorized spaces…
      </p>
    );
  if (!rows.length)
    return (
      <div className="discovery-empty">
        <Search size={25} />
        <h2>
          {query.hasNextPage
            ? 'This page no longer has accessible matches.'
            : 'No matches in your spaces.'}
        </h2>
        <p>
          {query.hasNextPage
            ? 'More results may be available. Continue loading or refresh your search.'
            : 'Try another name or title, change the type, or include archived projects.'}
        </p>
        {query.hasNextPage ? (
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading results…' : 'Load more results'}
          </Button>
        ) : null}
      </div>
    );
  return (
    <>
      <p className="discovery-feedback" role="status">
        {rows.length} result{rows.length === 1 ? '' : 's'} loaded
        {query.hasNextPage ? ' · more available' : ''}
      </p>
      <nav
        aria-label="Search results"
        className={`discovery-results ${compact ? 'discovery-results-compact' : ''}`}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          const links = [...e.currentTarget.querySelectorAll('a')],
            at = links.indexOf(document.activeElement as HTMLAnchorElement);
          e.preventDefault();
          links[(at + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]?.focus();
        }}
      >
        {rows.map((row) => (
          <SearchResult key={`${row.kind}-${row.id}`} row={row} onChoose={onChoose} />
        ))}
      </nav>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Loading results…' : 'Load more results'}
        </Button>
      ) : null}
    </>
  );
}
function SearchResult({
  row,
  onChoose,
}: {
  row: z.infer<typeof searchResultSchema>;
  onChoose: (() => void) | undefined;
}) {
  const Icon =
    row.kind === 'task'
      ? CheckSquare
      : row.kind === 'document'
        ? FileText
        : row.kind === 'file'
          ? Paperclip
          : row.kind === 'organization'
            ? Building2
            : Folder;
  return (
    <Link to={row.href} onClick={onChoose} className="discovery-result">
      <span className="discovery-result-icon">
        <Icon size={19} />
      </span>
      <span className="discovery-result-text">
        <strong>{row.title}</strong>
        <span>
          {row.kind}
          {row.archived ? ' · Archived' : ''} · {row.context}
        </span>
      </span>
      <ArrowUpRight aria-hidden="true" size={17} />
    </Link>
  );
}
