import { useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Circle,
  CircleDashed,
  LayoutGrid,
  List,
  Layers3,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Sparkles,
  Target,
} from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@orbit/ui';

const tasks = [
  {
    id: 'ORB-024',
    title: 'Map the onboarding journey',
    label: 'Design',
    initials: 'AL',
    status: 'Planned',
    color: 'violet',
  },
  {
    id: 'ORB-025',
    title: 'Build a little more delight',
    label: 'Experience',
    initials: 'MK',
    status: 'In progress',
    color: 'cyan',
  },
  {
    id: 'ORB-026',
    title: 'Bring the new identity to life',
    label: 'Brand',
    initials: 'JS',
    status: 'In progress',
    color: 'amber',
  },
  {
    id: 'ORB-027',
    title: 'Give every detail its space',
    label: 'Design',
    initials: 'AL',
    status: 'Done',
    color: 'violet',
  },
  {
    id: 'ORB-028',
    title: 'Share the launch story',
    label: 'Content',
    initials: 'MK',
    status: 'Planned',
    color: 'cyan',
  },
];

export function ProductPreview() {
  const [filter, setFilter] = useState(false);
  const [selected, setSelected] = useState<(typeof tasks)[number] | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const visibleTasks = filter ? tasks.filter((task) => task.label === 'Design') : tasks;
  function taskCard(task: (typeof tasks)[number]) {
    return (
      <button
        className="preview-task"
        key={task.id}
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setSelected(task);
        }}
      >
        <span className="preview-task-meta">
          <span>{task.id}</span>
          <ArrowUpRight size={13} />
        </span>
        <strong>{task.title}</strong>
        <span className="preview-task-bottom">
          <span className={`preview-tag ${task.color}`}>{task.label}</span>
          <span className={`preview-avatar ${task.color}`}>{task.initials}</span>
        </span>
      </button>
    );
  }
  return (
    <>
      <div className="product-window">
        <div className="preview-sidebar" aria-hidden="true">
          <div className="preview-workspace">
            <img src="/orbit.svg" alt="" width="25" height="25" />
            <strong>Studio North</strong>
            <span>⌄</span>
          </div>
          <span className="preview-side-item">
            <Circle size={15} /> Overview
          </span>
          <span className="preview-side-item selected">
            <Layers3 size={15} /> Projects <span>3</span>
          </span>
          <span className="preview-side-item">
            <Target size={15} /> Goals
          </span>
          <span className="preview-side-item">
            <MessageSquare size={15} /> Updates
          </span>
          <small>YOUR PROJECTS</small>
          <span className="preview-side-item">
            <span className="project-dot" /> Website launch
          </span>
          <span className="preview-side-item">
            <span className="project-dot cyan" /> Design system
          </span>
          <span className="preview-side-item">
            <span className="project-dot amber" /> Spring campaign
          </span>
          <div className="preview-side-bottom">
            <span className="preview-avatar violet">AL</span>
            <span>
              Alex Lee<small>Personal workspace</small>
            </span>
          </div>
        </div>
        <div className="preview-main">
          <div className="preview-breadcrumb">
            <span>
              Projects <span>/</span> Website launch
            </span>
            <span className="preview-sample">SAMPLE WORKSPACE</span>
          </div>
          <div className="preview-project-title">
            <div>
              <span className="preview-project-icon">
                <Layers3 size={23} />
              </span>
              <h3>Website launch</h3>
              <p>A fresh start. A shared direction.</p>
            </div>
            <span className="preview-members" aria-label="Three sample team members">
              <span className="preview-avatar violet">AL</span>
              <span className="preview-avatar cyan">MK</span>
              <span className="preview-avatar amber">JS</span>
            </span>
          </div>
          <Tabs defaultValue="board">
            <div className="preview-toolbar">
              <TabsList aria-label="Product preview view">
                <TabsTrigger value="board">
                  <LayoutGrid size={14} /> Board
                </TabsTrigger>
                <TabsTrigger value="list">
                  <List size={14} /> List
                </TabsTrigger>
              </TabsList>
              <button
                className={`preview-filter ${filter ? 'active' : ''}`}
                aria-pressed={filter}
                onClick={() => setFilter(!filter)}
              >
                Design only
              </button>
            </div>
            <TabsContent value="board">
              <div className="preview-board">
                {(['Planned', 'In progress', 'Done'] as const).map((status, index) => (
                  <div className="preview-column" key={status}>
                    <div className="preview-column-heading">
                      {index === 0 ? (
                        <CircleDashed size={14} />
                      ) : index === 1 ? (
                        <Circle size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                      <strong>{status}</strong>
                      <span>{visibleTasks.filter((task) => task.status === status).length}</span>
                      <MoreHorizontal size={15} />
                    </div>
                    {visibleTasks.filter((task) => task.status === status).map(taskCard)}
                  </div>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="list">
              <div className="preview-list">
                {visibleTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={(event) => {
                      trigger.current = event.currentTarget;
                      setSelected(task);
                    }}
                  >
                    <span>{task.id}</span>
                    <strong>{task.title}</strong>
                    <span className="preview-list-status">{task.status}</span>
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
            </TabsContent>
          </Tabs>
          <div className="preview-bottom">
            <span>
              <Sparkles size={13} /> A little clarity goes a long way.
            </span>
            <span>{visibleTasks.length} sample tasks</span>
          </div>
        </div>
      </div>
      <p className="preview-caption">
        <span className="status-dot" /> Interactive product preview <span>·</span> Sample content.
        Try the views, filter, and task cards.
      </p>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus({ preventScroll: true });
          }}
        >
          <DialogTitle>{selected?.title ?? 'Sample task'}</DialogTitle>
          <DialogDescription>Product demonstration · {selected?.id}</DialogDescription>
          <div className="sample-task-details">
            <span className="preview-tag violet">{selected?.label}</span>
            <span>{selected?.status}</span>
            <p>
              This sample task shows how work could stay connected to its owner, status, and
              project. Project creation and editing are coming in a later release.
            </p>
          </div>
          <Button onClick={() => setSelected(null)}>Back to preview</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkflowIllustration() {
  return (
    <div
      className="workflow-illustration"
      aria-label="Illustration: an idea connected to a project and a milestone"
    >
      <div>
        <span className="workflow-icon">
          <Sparkles size={18} />
        </span>
        <span>The idea</span>
        <small>A better first impression</small>
      </div>
      <span className="workflow-line" />
      <div>
        <span className="workflow-icon">
          <Layers3 size={18} />
        </span>
        <span>The project</span>
        <small>Website launch</small>
      </div>
      <span className="workflow-line" />
      <div>
        <span className="workflow-icon">
          <Target size={18} />
        </span>
        <span>The milestone</span>
        <small>Ready for the world</small>
        <Check size={14} />
      </div>
    </div>
  );
}

export function NotesIllustration() {
  return (
    <div className="notes-illustration" aria-hidden="true">
      <div>
        <span className="preview-avatar cyan">MK</span>
        <p>
          <strong>Maya Kim</strong>
          <span>Let’s give this idea a little room to grow.</span>
        </p>
        <small>now</small>
      </div>
      <div className="note-attachment">
        <span>
          <Plus size={15} /> Launch direction
        </span>
        <small>One place for the why behind the work.</small>
      </div>
    </div>
  );
}
