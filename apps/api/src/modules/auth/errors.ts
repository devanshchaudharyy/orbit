export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const unavailable = () =>
  new AuthError(
    503,
    'AUTH_UNAVAILABLE',
    'Account services are unavailable. Please try again shortly.',
  );

export const unauthorized = () => new AuthError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
