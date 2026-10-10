import { Router } from 'express';
import { AuthController } from './controller.js';
import type { AuthService } from './service.js';

export function authRoutes(service: AuthService) {
  const router = Router();
  const controller = new AuthController(service);
  router.get('/session', controller.session);
  router.post('/register', controller.register);
  router.post('/login', controller.login);
  router.post('/logout', controller.logout);
  router.post('/logout-all', controller.logoutAll);
  router.get('/profile', controller.profile);
  router.patch('/profile', controller.updateProfile);
  router.post('/onboarding', controller.onboarding);
  router.post('/resend-verification', controller.resend);
  router.post('/verify-email', controller.verifyEmail);
  router.post('/forgot-password', controller.forgotPassword);
  router.post('/reset-password', controller.resetPassword);
  router.post('/change-password', controller.changePassword);
  router.get('/sessions', controller.sessions);
  router.delete('/sessions/:id', controller.revokeSession);
  return router;
}
