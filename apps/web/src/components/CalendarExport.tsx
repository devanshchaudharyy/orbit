import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@orbit/ui';
import { calendarQuerySchema, apiErrorSchema } from '@orbit/contracts';
import { StatusNotice } from './AuthLayout';
export function CalendarExport({
  org,
  workspace,
  project,
}: {
  org: string;
  workspace: string;
  project: string;
}) {
  const [open, setOpen] = useState(false),
    [from, setFrom] = useState(new Date().toISOString().slice(0, 10)),
    [to, setTo] = useState(new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function change(value: boolean) {
    if (!value) controller.current?.abort();
    setOpen(value);
    setError('');
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button size="small" variant="outline">
          <CalendarDays size={15} />
          Export calendar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Take your deadlines with you.</DialogTitle>
        <DialogDescription>
          Download dated task titles from this project as a private calendar file. An organization
          administrator must enable export. Imported files do not automatically update.
        </DialogDescription>
        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = calendarQuerySchema.safeParse({ from, to });
            if (!result.success) {
              setError(result.error.issues[0]?.message ?? 'Check the date window.');
              return;
            }
            setError('');
            setPending(true);
            const current = new AbortController();
            controller.current = current;
            try {
              const response = await fetch(
                `/api/v1/discovery/organizations/${org}/workspaces/${workspace}/projects/${project}/calendar?${new URLSearchParams(result.data)}`,
                {
                  credentials: 'same-origin',
                  signal: AbortSignal.any([current.signal, AbortSignal.timeout(10000)]),
                },
              );
              if (!response.ok) {
                const failure = apiErrorSchema.safeParse(await response.json().catch(() => null));
                throw new Error(
                  failure.success
                    ? failure.data.error.message
                    : 'Calendar export is unavailable. Try again.',
                );
              }
              const blob = await response.blob();
              if (current.signal.aborted) return;
              const url = URL.createObjectURL(blob),
                link = document.createElement('a');
              link.href = url;
              link.download = 'orbit-deadlines.ics';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              change(false);
            } catch (caught) {
              if (!current.signal.aborted)
                setError(
                  caught instanceof Error ? caught.message : 'Calendar export is unavailable.',
                );
            } finally {
              setPending(false);
            }
          }}
        >
          <label htmlFor="calendar-from">From (inclusive)</label>
          <Input
            id="calendar-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <label htmlFor="calendar-to">To (inclusive)</label>
          <Input id="calendar-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <p className="discovery-feedback">
            At most 366 days and 2,000 dated tasks. Undated and deleted tasks are excluded. Keep
            downloaded files private.
          </p>
          {error ? <StatusNotice>{error}</StatusNotice> : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Preparing calendar…' : 'Download calendar file'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
