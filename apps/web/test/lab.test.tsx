import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ComponentSection, PatternSection } from '../src/components/ComponentDemos';
import { ThemeProvider } from '../src/components/ThemeProvider';
import { ThemeControl } from '../src/components/LabNavigation';
import { TooltipProvider } from '@orbit/ui';
import { useUI } from '../src/state/ui';

function components() {
  return render(
    <TooltipProvider>
      <ComponentSection />
    </TooltipProvider>,
  );
}
describe('Component lab interactions', () => {
  it('validates an empty example and accepts a valid title', async () => {
    const user = userEvent.setup();
    components();
    await user.click(screen.getByRole('button', { name: /Validate example/ }));
    expect(await screen.findByText('Use at least 3 characters.')).toBeVisible();
    expect(screen.getByLabelText(/Example title/)).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText(/Example title/), 'Design foundation');
    await user.click(screen.getByRole('button', { name: /Validate example/ }));
    expect(await screen.findByRole('button', { name: 'Validated' })).toBeVisible();
  });
  it('opens a dialog with an accessible description and closes it with Escape', async () => {
    const user = userEvent.setup();
    components();
    await user.click(screen.getByRole('button', { name: /Open dialog/ }));
    const dialog = screen.getByRole('dialog', { name: 'Room for your next idea.' });
    expect(dialog).toHaveAttribute('aria-describedby');
    await user.keyboard('{Escape}');
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open dialog/ })).toHaveFocus();
  });
  it('changes real theme preference in the drawer', async () => {
    const user = userEvent.setup();
    components();
    await user.click(screen.getByRole('button', { name: /Open drawer/ }));
    expect(screen.getByRole('dialog', { name: 'Make yourself at home.' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Drawer appearance' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Done/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('moves between empty, success, and error states through actions', async () => {
    const user = userEvent.setup();
    render(<PatternSection />);
    await user.click(screen.getByRole('button', { name: /Add an example/ }));
    expect(screen.getByText('You’re all set.')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Error' }));
    expect(screen.getByText('A small interruption.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.getByText('You’re all set.')).toBeVisible();
  });
  it('selects rows and clears selection without mutating sample data', async () => {
    const user = userEvent.setup();
    render(<PatternSection />);
    await user.click(screen.getByRole('checkbox', { name: 'Select Button family' }));
    expect(screen.getByText('1 selected')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('checkbox', { name: 'Select Button family' })).not.toBeChecked();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
  });
  it('persists appearance and applies it to the root element', async () => {
    useUI.getState().setTheme('dark');
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <TooltipProvider>
          <ThemeControl />
        </TooltipProvider>
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('orbit.theme.v1')).toBe('light');
    await user.click(screen.getByRole('button', { name: 'System theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    useUI.getState().setTheme('dark');
  });
});
