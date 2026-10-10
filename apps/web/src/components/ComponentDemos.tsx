import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CircleCheck,
  CircleAlert,
  Copy,
  Inbox,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  Skeleton,
  Switch,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
} from '@orbit/ui';
import { toast } from 'sonner';
import { useUI } from '../state/ui';

const demoSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Use at least 3 characters.')
    .max(60, 'Keep the title under 60 characters.'),
  description: z.string().max(240, 'Keep the description under 240 characters.'),
});

function FormDemo() {
  const [notifications, setNotifications] = useState(true);
  const [priority, setPriority] = useState('medium');
  const [saved, setSaved] = useState(false);
  const form = useForm<z.infer<typeof demoSchema>>({
    resolver: zodResolver(demoSchema),
    defaultValues: { title: '', description: '' },
  });
  return (
    <Card className="demo-card form-card">
      <div className="demo-card-heading">
        <div>
          <h3>Inputs & forms</h3>
          <p>Good conversations start with clear inputs.</p>
        </div>
        <Badge>Interactive</Badge>
      </div>
      <form
        onSubmit={form.handleSubmit(() => {
          setSaved(true);
          toast.success('Example validated', {
            description: `Your ${priority}-priority example is valid${notifications ? ' with notifications selected' : ''}.`,
          });
        })}
        noValidate
      >
        <Label htmlFor="demo-title">
          Example title <span className="required">*</span>
        </Label>
        <Input
          id="demo-title"
          placeholder="e.g. A better way to work"
          {...form.register('title', { onChange: () => setSaved(false) })}
          aria-invalid={!!form.formState.errors.title}
          aria-describedby="title-feedback"
        />
        <p
          id="title-feedback"
          className={form.formState.errors.title ? 'form-error' : 'field-hint'}
        >
          {form.formState.errors.title?.message ?? 'A title with 3–60 characters.'}
        </p>
        <div className="form-row">
          <div>
            <Label>Priority</Label>
            <Select
              label="Example priority"
              value={priority}
              onValueChange={setPriority}
              options={[
                { value: 'low', label: 'Low priority' },
                { value: 'medium', label: 'Medium priority' },
                { value: 'high', label: 'High priority' },
              ]}
            />
          </div>
          <div className="form-switch-row">
            <div>
              <Label htmlFor="demo-notify">Notifications</Label>
              <span className="field-hint">Preference example</span>
            </div>
            <Switch id="demo-notify" checked={notifications} onCheckedChange={setNotifications} />
          </div>
        </div>
        <Label htmlFor="demo-description">
          Description <span className="optional">optional</span>
        </Label>
        <Textarea
          id="demo-description"
          placeholder="Give your idea a little context…"
          {...form.register('description')}
          aria-invalid={!!form.formState.errors.description}
          aria-describedby={form.formState.errors.description ? 'description-feedback' : undefined}
        />
        {form.formState.errors.description ? (
          <p id="description-feedback" className="form-error">
            {form.formState.errors.description.message}
          </p>
        ) : null}
        <div className="form-footer">
          <span className="demo-disclaimer">Component example · no project persistence</span>
          <Button type="submit" size="small">
            {saved ? (
              <>
                <Check /> Validated
              </>
            ) : (
              <>
                Validate example <ArrowRight />
              </>
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ButtonDemo() {
  const [selected, setSelected] = useState(false);
  return (
    <Card className="demo-card">
      <div className="demo-card-heading">
        <div>
          <h3>Buttons & actions</h3>
          <p>The next step, always unmistakable.</p>
        </div>
        <span className="component-tag">BUTTON</span>
      </div>
      <div className="button-examples">
        <Button onClick={() => toast.success('Primary action selected')}>
          <Plus /> Primary action
        </Button>
        <Button variant="secondary" onClick={() => toast('Secondary action selected')}>
          Secondary
        </Button>
        <Button variant="outline" onClick={() => toast('Outline action selected')}>
          Outline <ArrowUpRight />
        </Button>
        <Button variant="ghost" onClick={() => toast('Ghost action selected')}>
          Ghost action <ArrowRight />
        </Button>
        <Tooltip content="This is an intentionally disabled component state.">
          <span>
            <Button disabled>Disabled</Button>
          </span>
        </Tooltip>
        <Button
          variant="danger"
          onClick={() =>
            toast('Destructive style preview', {
              description: 'This demonstration does not delete data.',
            })
          }
        >
          <Trash2 /> Destructive
        </Button>
      </div>
      <div className="component-divider" />
      <div className="control-demo-row">
        <div className="inline-controls">
          <Checkbox
            id="demo-checkbox"
            checked={selected}
            onCheckedChange={(value) => setSelected(value === true)}
          />
          <label htmlFor="demo-checkbox">
            {selected ? 'Example selected' : 'Select this example'}
          </label>
        </div>
        <div className="icon-buttons">
          <Tooltip content="Show a notification">
            <Button
              variant="outline"
              size="icon"
              aria-label="Show a notification"
              onClick={() =>
                toast('A little update', {
                  description: 'Notification feedback, styled for your current theme.',
                })
              }
            >
              <Bell />
            </Button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More example actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => toast('Example duplicated')}>
                Duplicate example <Copy size={13} />
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  document.getElementById('patterns')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                View state patterns <ArrowUpRight size={13} />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}

function OverlayDemo() {
  const theme = useUI((state) => state.theme);
  const setTheme = useUI((state) => state.setTheme);
  return (
    <Card className="demo-card">
      <div className="demo-card-heading">
        <div>
          <h3>Layers & feedback</h3>
          <p>Room for detail. Space to stay focused.</p>
        </div>
        <span className="component-tag">OVERLAYS</span>
      </div>
      <div className="overlay-preview" aria-hidden="true">
        <div className="preview-window">
          <span className="preview-dot" />
          <span />
          <span />
        </div>
        <div className="preview-modal">
          <div className="preview-modal-icon">
            <Sparkles size={14} />
          </div>
          <div className="preview-line long" />
          <div className="preview-line" />
          <div className="preview-modal-button" />
        </div>
      </div>
      <div className="overlay-actions">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary" size="small">
              Open dialog <ArrowUpRight />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <div className="modal-symbol">
              <Sparkles size={22} />
            </div>
            <DialogTitle>Room for your next idea.</DialogTitle>
            <DialogDescription>
              This dialog demonstrates a focused interaction: keyboard navigation, a contained tab
              order, and focus that returns when you close it.
            </DialogDescription>
            <div className="dialog-actions">
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button onClick={() => toast.success('Dialog interaction complete')}>
                  Sounds good <Check />
                </Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="small">
              Open drawer <SlidersHorizontal />
            </Button>
          </DialogTrigger>
          <DialogContent sheet>
            <DialogTitle>Make yourself at home.</DialogTitle>
            <DialogDescription>
              These appearance settings update the actual lab and persist between visits.
            </DialogDescription>
            <div className="drawer-field">
              <Label>Appearance</Label>
              <Select
                label="Drawer appearance"
                value={theme}
                onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                  { value: 'system', label: 'System' },
                ]}
              />
            </div>
            <p className="drawer-note">Motion follows your system’s reduced-motion preference.</p>
            <DialogClose asChild>
              <Button className="drawer-close">
                Done <Check />
              </Button>
            </DialogClose>
          </DialogContent>
        </Dialog>
        <Tooltip content="Toasts announce feedback to assistive technology.">
          <Button
            variant="ghost"
            size="small"
            onClick={() =>
              toast.success('Right where you need it', {
                description: 'Clear feedback without interrupting your flow.',
              })
            }
          >
            Show toast <Bell />
          </Button>
        </Tooltip>
      </div>
    </Card>
  );
}

export function ComponentSection() {
  return (
    <section id="components" tabIndex={-1} className="lab-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">03 / COMPONENTS</p>
          <h2>
            Small pieces. Better experiences<span>.</span>
          </h2>
          <p>Try them out. Every interaction here is a working component example.</p>
        </div>
        <Badge tone="violet">
          <Sparkles size={10} /> Try it live
        </Badge>
      </div>
      <div className="components-grid">
        <div className="component-stack">
          <ButtonDemo />
          <OverlayDemo />
        </div>
        <FormDemo />
      </div>
    </section>
  );
}

export function PatternSection() {
  const [state, setState] = useState('empty');
  const [selected, setSelected] = useState<string[]>([]);
  const rows = [
    {
      id: 'buttons',
      label: 'Button family',
      category: 'Actions',
      status: 'Interactive',
      tone: 'green',
    },
    {
      id: 'dialogs',
      label: 'Dialog & drawer',
      category: 'Overlays',
      status: 'Keyboard ready',
      tone: 'violet',
    },
    {
      id: 'inputs',
      label: 'Input & validation',
      category: 'Forms',
      status: 'Interactive',
      tone: 'green',
    },
  ] as const;
  return (
    <section id="patterns" tabIndex={-1} className="lab-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">04 / PATTERNS</p>
          <h2>
            Every state deserves care<span>.</span>
          </h2>
          <p>Useful feedback through the quiet moments and the unexpected ones.</p>
        </div>
      </div>
      <div className="patterns-grid">
        <Card className="demo-card state-demo">
          <div className="demo-card-heading">
            <div>
              <h3>Interface states</h3>
              <p>Demonstrations, not live service status.</p>
            </div>
            <Settings2 size={15} className="muted" />
          </div>
          <Tabs value={state} onValueChange={setState}>
            <TabsList aria-label="Interface state examples">
              <TabsTrigger value="empty">Empty</TabsTrigger>
              <TabsTrigger value="loading">Loading</TabsTrigger>
              <TabsTrigger value="error">Error</TabsTrigger>
              <TabsTrigger value="success">Success</TabsTrigger>
            </TabsList>
            <TabsContent value="empty">
              <div className="state-body">
                <div className="state-icon">
                  <Inbox size={26} />
                </div>
                <h4>A fresh start.</h4>
                <p>Great things start with a little space.</p>
                <Button variant="secondary" size="small" onClick={() => setState('success')}>
                  <Plus /> Add an example
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="loading">
              <div className="loading-state" role="status" aria-label="Loading example">
                <div className="skeleton-row">
                  <Skeleton className="skeleton-avatar" />
                  <div>
                    <Skeleton className="skeleton-title" />
                    <Skeleton className="skeleton-description" />
                  </div>
                </div>
                <Skeleton className="skeleton-block" />
                <div className="loading-label">
                  <LoaderCircle size={13} className="spin" /> Getting things ready…
                </div>
              </div>
            </TabsContent>
            <TabsContent value="error">
              <div className="state-body">
                <div className="state-icon error">
                  <CircleAlert size={25} />
                </div>
                <h4>A small interruption.</h4>
                <p>Try again to continue your example.</p>
                <Button variant="secondary" size="small" onClick={() => setState('success')}>
                  Try again <ArrowRight />
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="success">
              <div className="state-body">
                <div className="state-icon success">
                  <CircleCheck size={25} />
                </div>
                <h4>You’re all set.</h4>
                <p>Your example interaction is complete.</p>
                <Button variant="ghost" size="small" onClick={() => setState('empty')}>
                  Reset example <ArrowRight />
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </Card>
        <Card className="table-card">
          <div className="demo-card-heading">
            <div>
              <h3>Structured, never crowded.</h3>
              <p>Table and selection component examples.</p>
            </div>
            <Badge>{selected.length ? `${selected.length} selected` : 'Sample content'}</Badge>
          </div>
          <Table>
            <caption className="sr-only">Design component examples</caption>
            <thead>
              <tr>
                <th scope="col">Select</th>
                <th scope="col">Component</th>
                <th scope="col">Category</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Checkbox
                      aria-label={`Select ${row.label}`}
                      checked={selected.includes(row.id)}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked ? [...current, row.id] : current.filter((id) => id !== row.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <span className="table-component-name">{row.label}</span>
                  </td>
                  <td className="muted">{row.category}</td>
                  <td>
                    <Badge tone={row.tone}>{row.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="table-footer">
            <span>Example rows · local UI state only</span>
            <Button
              variant="ghost"
              size="small"
              disabled={!selected.length}
              onClick={() => setSelected([])}
            >
              Clear selection
            </Button>
          </div>
          <div className="badge-examples">
            <span className="component-tag">STATUS PALETTE</span>
            <div>
              <Badge>Draft</Badge>
              <Badge tone="violet">In progress</Badge>
              <Badge tone="cyan">In review</Badge>
              <Badge tone="green">Complete</Badge>
              <Badge tone="amber">Attention</Badge>
              <Badge tone="red">Blocked</Badge>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
