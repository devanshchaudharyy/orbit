import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  Slot,
  Switch as SwitchPrimitive,
  Checkbox as CheckboxPrimitive,
  Tabs as TabsPrimitive,
} from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from './utils';

const buttonVariants = cva('orbit-button', {
  variants: {
    variant: {
      primary: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      outline: 'button-outline',
      danger: 'button-danger',
    },
    size: { default: '', small: 'button-small', icon: 'button-icon' },
  },
  defaultVariants: { variant: 'primary', size: 'default' },
});
export function Button({
  className,
  variant,
  size,
  asChild = false,
  type = 'button',
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn('orbit-input', className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn('orbit-input orbit-textarea', className)} {...props} />;
}
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('orbit-label', className)} {...props} />;
}
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('orbit-card', className)} {...props} />;
}
export function Badge({
  className,
  tone = 'neutral',
  ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'violet' | 'cyan' | 'green' | 'amber' | 'red' }) {
  return <span className={cn('orbit-badge', `badge-${tone}`, className)} {...props} />;
}
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('orbit-skeleton', className)} {...props} />;
}
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn('orbit-switch', className)} {...props}>
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root className={cn('orbit-checkbox', className)} {...props}>
      <CheckboxPrimitive.Indicator>
        <Check size={13} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('orbit-tabs-list', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={cn('orbit-tab', className)} {...props} />;
}
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('orbit-tab-content', className)} {...props} />;
}
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="table-scroll">
      <table className={cn('orbit-table', className)} {...props} />
    </div>
  );
}
