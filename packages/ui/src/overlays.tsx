import type { ComponentProps } from 'react';
import {
  Dialog as DialogPrimitive,
  DropdownMenu as MenuPrimitive,
  Tooltip as TooltipPrimitive,
  Select as SelectPrimitive,
  Accordion as AccordionPrimitive,
} from 'radix-ui';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from './utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({
  children,
  className,
  sheet = false,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { sheet?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="orbit-overlay" />
      <DialogPrimitive.Content
        className={cn('orbit-dialog', sheet && 'orbit-sheet', className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="overlay-close" aria-label="Close dialog">
          <X size={18} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export function DropdownMenuContent({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content sideOffset={8} className={cn('orbit-menu', className)} {...props} />
    </MenuPrimitive.Portal>
  );
}
export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item>) {
  return <MenuPrimitive.Item className={cn('orbit-menu-item', className)} {...props} />;
}
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ children, content }: { children: React.ReactNode; content: string }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content sideOffset={8} className="orbit-tooltip">
          {content}
          <TooltipPrimitive.Arrow />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
export function Select({
  value,
  onValueChange,
  options,
  label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger className="orbit-input orbit-select" aria-label={label}>
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={5}
          className="orbit-menu select-content"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                value={option.value}
                key={option.value}
                className="orbit-menu-item"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={14} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
export function Accordion({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <AccordionPrimitive.Root type="single" collapsible>
      <AccordionPrimitive.Item value="details">
        <AccordionPrimitive.Header>
          <AccordionPrimitive.Trigger className="accordion-trigger">
            {title}
            <ChevronDown size={15} />
          </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
        <AccordionPrimitive.Content className="accordion-content">
          {children}
        </AccordionPrimitive.Content>
      </AccordionPrimitive.Item>
    </AccordionPrimitive.Root>
  );
}
