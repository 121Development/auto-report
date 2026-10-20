import * as Tooltip from '@radix-ui/react-tooltip'
import type { LucideIcon } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
    {children}
  </Tooltip.Provider>
)

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon
  /** Accessible name, also shown as the tooltip. */
  label: string
  shortcut?: string
  tone?: 'default' | 'accent' | 'positive' | 'negative'
  pressed?: boolean
  size?: number
  /** Optional visible text next to the icon. */
  text?: string
}

/** Icon-only (or icon + short text) button with a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, shortcut, tone = 'default', pressed, size = 16, text, className, ...rest },
  ref,
) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          className={`icon-btn tone-${tone}${text ? ' with-text' : ''}${className ? ` ${className}` : ''}`}
          {...rest}
        >
          <Icon size={size} strokeWidth={1.75} aria-hidden />
          {text && <span>{text}</span>}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side="bottom" sideOffset={6} collisionPadding={8}>
          {label}
          {shortcut && <kbd>{shortcut}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
})
