import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppBoundary } from '../src/components/AppBoundary';

it('recovers from a render failure with focused, safe feedback and no automatic replay', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  function Failure(): never {
    throw new Error('private-data-must-not-render');
  }
  try {
    render(
      <AppBoundary>
        <Failure />
      </AppBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'ORBIT could not open this page' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Changes that were not saved');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to your organizations' })).toHaveAttribute(
      'href',
      '/app',
    );
    expect(document.body).not.toHaveTextContent('private-data-must-not-render');
  } finally {
    error.mockRestore();
  }
});
