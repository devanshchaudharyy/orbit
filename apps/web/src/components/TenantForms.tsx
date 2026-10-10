import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  organizationInputSchema,
  organizationSchema,
  workspaceInputSchema,
  workspaceSchema,
  type Organization,
  type Workspace,
} from '@orbit/contracts';
import {
  Button,
  Input,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@orbit/ui';
import { Plus, LockKeyhole } from 'lucide-react';
import { FormField, StatusNotice, SubmitButton } from './AuthLayout';
import { authErrorMessage, useAuth } from '../lib/auth';
import { orgPath, wsPath, tenantKey } from '../lib/tenants';
import { timezoneOptions } from '../pages/Onboarding';

export function TenantForm({
  organizationId,
  initial,
  onSaved,
  reload,
}: {
  organizationId?: string;
  initial?: Organization | Workspace;
  onSaved: (resource: Organization | Workspace) => void;
  reload?: () => void;
}) {
  const workspace = organizationId !== undefined;
  const auth = useAuth();
  const client = useQueryClient();
  const [failure, setFailure] = useState('');
  // Keep the version paired with the editable values. A background refetch
  // must not bless an old form with a newer server version.
  const [version, setVersion] = useState(initial?.version);
  const form = useForm<z.input<typeof workspaceInputSchema>>({
    resolver: zodResolver(workspaceInputSchema),
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      timezone:
        initial && 'timezone' in initial ? initial.timezone : (auth.user?.timezone ?? 'UTC'),
    },
  });
  return (
    <form
      className="auth-form tenant-form"
      noValidate
      onSubmit={form.handleSubmit(async (input) => {
        setFailure('');
        try {
          const path = workspace
            ? `/${organizationId}/workspaces${initial ? `/${initial.id}` : ''}`
            : initial
              ? `/${initial.id}`
              : '';
          const values = workspace
            ? input
            : organizationInputSchema.parse({ name: input.name, description: input.description });
          const data = initial ? { ...values, version } : values;
          const saved = workspace
            ? await auth.request(
                path,
                workspaceSchema,
                initial ? 'PATCH' : 'POST',
                data,
                'organizations',
              )
            : await auth.request(
                path,
                organizationSchema,
                initial ? 'PATCH' : 'POST',
                data,
                'organizations',
              );
          setVersion(saved.version);
          form.reset({
            name: saved.name,
            description: saved.description,
            timezone: 'timezone' in saved ? saved.timezone : (auth.user?.timezone ?? 'UTC'),
          });
          // Do not show a prior version while invalidated lists refetch.
          client.setQueryData(
            [
              ...tenantKey(auth.user?.id),
              workspace ? 'workspace' : 'organization',
              ...(workspace ? [organizationId, saved.id] : [saved.id]),
            ],
            saved,
          );
          await client.invalidateQueries({ queryKey: tenantKey(auth.user?.id) });
          onSaved(saved);
        } catch (error) {
          setFailure(authErrorMessage(error));
        }
      })}
    >
      <FormField
        id="space-name"
        label={workspace ? 'Workspace name' : 'Organization name'}
        error={form.formState.errors.name?.message}
      >
        <Input
          id="space-name"
          placeholder={workspace ? 'e.g. Product studio' : 'e.g. Northstar'}
          autoComplete="off"
          maxLength={80}
          {...form.register('name')}
          aria-invalid={!!form.formState.errors.name}
          aria-describedby={form.formState.errors.name ? 'space-name-error' : undefined}
        />
      </FormField>
      <FormField
        id="space-description"
        label="Description (optional)"
        error={form.formState.errors.description?.message}
      >
        <textarea
          id="space-description"
          className="orbit-input"
          rows={3}
          placeholder={
            workspace
              ? 'What will this workspace focus on?'
              : 'A few words about your organization.'
          }
          maxLength={500}
          {...form.register('description')}
          aria-invalid={!!form.formState.errors.description}
          aria-describedby={
            form.formState.errors.description ? 'space-description-error' : undefined
          }
        />
      </FormField>
      {workspace ? (
        <FormField
          id="space-timezone"
          label="Workspace time zone"
          error={form.formState.errors.timezone?.message}
        >
          <select
            id="space-timezone"
            className="orbit-input"
            {...form.register('timezone')}
            aria-invalid={!!form.formState.errors.timezone}
            aria-describedby={form.formState.errors.timezone ? 'space-timezone-error' : undefined}
          >
            {timezoneOptions(form.getValues('timezone') ?? 'UTC').map((zone) => (
              <option value={zone} key={zone}>
                {zone.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}
      {failure ? (
        <StatusNotice>
          {failure}
          {reload ? (
            <Button variant="ghost" size="small" onClick={reload}>
              Reload latest settings
            </Button>
          ) : null}
        </StatusNotice>
      ) : null}
      <div className="tenant-privacy">
        <LockKeyhole size={15} aria-hidden="true" />
        <span>
          {workspace
            ? 'Access is granted explicitly. Organization membership alone does not open this workspace.'
            : 'Your organization is a separate, private space. You will be its owner.'}
        </span>
      </div>
      <SubmitButton pending={form.formState.isSubmitting}>
        {initial ? 'Save changes' : workspace ? 'Create workspace' : 'Create organization'}
      </SubmitButton>
    </form>
  );
}

export function CreateSpace({
  organizationId,
  compact = false,
}: {
  organizationId?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const workspace = organizationId !== undefined;
  const label = workspace ? 'Create workspace' : 'Create organization';
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={compact ? 'small' : 'default'}>
          <Plus size={16} aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="tenant-create-dialog">
        <div className="tenant-dialog-icon">
          <Plus size={22} aria-hidden="true" />
        </div>
        <DialogTitle>
          {workspace ? 'Room for your next chapter.' : 'A place to build together.'}
        </DialogTitle>
        <DialogDescription>
          {workspace
            ? 'Give your work a home inside this organization.'
            : 'Start an organization, then create the workspaces you need.'}
        </DialogDescription>
        {open ? (
          <TenantForm
            {...(organizationId ? { organizationId } : {})}
            onSaved={(resource) => {
              setOpen(false);
              navigate(workspace ? wsPath(organizationId!, resource.id) : orgPath(resource.id));
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
