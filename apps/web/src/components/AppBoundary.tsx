import { Component, type ReactNode } from 'react';

export class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed)
      return (
        <main className="unavailable" tabIndex={-1} ref={(node) => node?.focus()}>
          <img src="/orbit.svg" width="48" height="48" alt="ORBIT" />
          <h1>ORBIT could not open this page</h1>
          <p role="alert">
            Reload to try again. Changes that were not saved may need to be entered again.
          </p>
          <button
            className="orbit-button button-primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
          <a href="/app">Back to your organizations</a>
        </main>
      );
    return this.props.children;
  }
}
