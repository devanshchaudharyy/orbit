import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@orbit/ui';
import Marketing from '../src/pages/Marketing';

function renderMarketing() {
  return render(
    <TooltipProvider>
      <Marketing />
    </TooltipProvider>,
  );
}

describe('Marketing product and plan previews', () => {
  it('filters sample work across views and opens contextual task details', async () => {
    const user = userEvent.setup();
    renderMarketing();
    await user.click(screen.getByRole('button', { name: 'Design only' }));
    await user.click(screen.getByRole('tab', { name: 'List' }));
    const list = screen.getByRole('tabpanel');
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    await user.click(within(list).getByRole('button', { name: /Map the onboarding journey/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Project creation and editing are coming in a later release.',
    );
  });
  it('carries the chosen billing period into a plan preview', async () => {
    const user = userEvent.setup();
    renderMarketing();
    await user.click(screen.getByRole('button', { name: /Yearly/ }));
    await user.click(screen.getByRole('button', { name: 'Explore Business' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('$20');
    expect(dialog).toHaveTextContent('Yearly pricing preview.');
    expect(dialog).toHaveTextContent('no payment is collected');
  });
  it('restarts the guided tour when reopened', async () => {
    const user = userEvent.setup();
    renderMarketing();
    const trigger = screen.getByRole('button', { name: 'Take the guided tour' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('See work your way.');
    await user.keyboard('{Escape}');
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveTextContent('Start with a shared direction.');
  });
});
