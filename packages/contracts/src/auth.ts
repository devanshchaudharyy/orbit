import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Use at most 128 characters.');
export const registerSchema = z
  .object({ name: z.string().trim().min(2).max(80), email: emailSchema, password: passwordSchema })
  .strict();
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();
export const resetPasswordSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/), newPassword: passwordSchema })
  .strict();
export const verifyEmailSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict();
export const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    jobTitle: z.string().trim().max(80).default(''),
    timezone: z
      .string()
      .max(80)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid time zone.'),
  })
  .strict();
export const onboardingSchema = profileSchema
  .extend({ useCase: z.enum(['personal', 'team', 'client']) })
  .strict();
export const userSchema = z.object({
  id: z.string(),
  email: emailSchema,
  name: z.string(),
  jobTitle: z.string(),
  timezone: z.string(),
  useCase: z.enum(['personal', 'team', 'client']).nullable(),
  emailVerified: z.boolean(),
  onboardingCompleted: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const authSessionSchema = z.object({ user: userSchema.nullable(), csrfToken: z.string() });
export const messageSchema = z.object({ message: z.string() });
export const sessionListSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      current: z.boolean(),
      createdAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      lastSeenAt: z.iso.datetime(),
    }),
  ),
});
export type OrbitUser = z.infer<typeof userSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
