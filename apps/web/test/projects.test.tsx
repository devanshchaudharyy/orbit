import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Project, Task } from '@orbit/contracts';
import { TaskEditor, ProjectEditor } from '../src/components/ProjectForms';
import { safeReturnTo, AuthServiceError } from '../src/lib/auth';
const request = vi.fn();
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ user: { id: 'a'.repeat(24) }, request }),
}));
const id = 'a'.repeat(24);
const ws = 'b'.repeat(24);
const projectId = 'c'.repeat(24);
const taskId = 'd'.repeat(24);
const date = '2026-10-10T00:00:00.000Z';
const project: Project = {
  id: projectId,
  organizationId: id,
  workspaceId: ws,
  name: 'Launch',
  description: '',
  status: 'active',
  priority: 'normal',
  cover: 'orbit',
  ownerId: id,
  memberIds: [],
  labels: [],
  version: 4,
  archived: false,
  createdAt: date,
  updatedAt: date,
  canManage: true,
  canAssignOwner: true,
  canWriteTasks: true,
  taskCount: 1,
  doneCount: 0,
};
const task: Task = {
  id: taskId,
  organizationId: id,
  workspaceId: ws,
  projectId,
  title: 'Review release',
  description: '',
  status: 'todo',
  priority: 'normal',
  dueDate: null,
  ownerId: null,
  parentId: null,
  assigneeIds: [],
  labelIds: [],
  checklist: [],
  version: 3,
  createdAt: date,
  updatedAt: date,
};
const props = {
  base: `/${id}/workspaces/${ws}/projects`,
  people: [{ id, name: 'Morgan Reed', role: 'owner', canAssign: true }],
  more: false,
  loadMore: vi.fn(),
  onSaved: vi.fn(async () => {}),
  onReload: vi.fn(async () => {}),
};
afterEach(() => {
  vi.clearAllMocks();
});
describe('project client boundaries', () => {
  it('accepts canonical project/task return routes and rejects query/open redirects', () => {
    const path = `/app/organizations/${id}/workspaces/${ws}/projects`;
    for (const value of [path, `${path}/${projectId}`, `${path}/${projectId}/tasks/${taskId}`])
      expect(safeReturnTo(value)).toBe(value);
    for (const value of [
      `${path}?next=https://foreign.test`,
      `${path}/${projectId}/tasks/${taskId}/extra`,
      `${path}/../settings`,
    ])
      expect(safeReturnTo(value)).toBe('/onboarding');
  });
  it('validates task text before transmitting a mutation', async () => {
    render(<TaskEditor {...props} action={{ kind: 'create-task', project }} />);
    const input = screen.getByLabelText('Task title');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 2');
    expect(request).not.toHaveBeenCalled();
  });
  it('pairs task values with the original version and requires explicit conflict recovery', async () => {
    request.mockRejectedValue(
      new AuthServiceError('This record changed.', 'VERSION_CONFLICT', 409),
    );
    const event = userEvent.setup();
    render(<TaskEditor {...props} action={{ kind: 'edit-task', project, task }} />);
    await event.click(screen.getByRole('button', { name: 'Save task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed');
    expect(request.mock.calls[0]?.[3]).toMatchObject({ version: 3, title: 'Review release' });
    await event.click(screen.getByRole('button', { name: 'Reload latest record' }));
    expect(props.onReload).toHaveBeenCalledOnce();
    expect(props.onSaved).not.toHaveBeenCalled();
  });
  it('submits checklist updates and an immutable parent on creation only', async () => {
    request.mockResolvedValue(task);
    const event = userEvent.setup();
    render(<TaskEditor {...props} action={{ kind: 'create-task', project, parentId: taskId }} />);
    await event.type(screen.getByLabelText('Task title'), 'Review mobile');
    await event.click(screen.getByRole('button', { name: 'Add checklist item' }));
    await event.type(screen.getByLabelText('Checklist item 1', { exact: true }), 'Review focus');
    await event.click(screen.getByLabelText('Complete checklist item 1'));
    await event.click(screen.getByRole('button', { name: 'Create task' }));
    expect(request.mock.calls[0]?.[3]).toMatchObject({
      parentId: taskId,
      checklist: [{ text: 'Review focus', done: true }],
    });
  });
  it('keeps project owner transfer disabled for a project owner without workspace management', () => {
    render(
      <ProjectEditor
        {...props}
        action={{ kind: 'edit-project', project: { ...project, canAssignOwner: false } }}
      />,
    );
    expect(screen.getByLabelText('Project owner')).toBeDisabled();
    expect(screen.queryByLabelText('Start from')).not.toBeInTheDocument();
  });
});
