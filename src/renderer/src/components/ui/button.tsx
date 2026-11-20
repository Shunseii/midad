import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Hover and press tint whatever background a variant has by laying a translucent ink wash over it.
const pressable =
  "transition-[box-shadow,background-color,color] duration-150 hover:shadow-[inset_0_0_0_100px_color-mix(in_oklab,var(--color-ink)_6%,transparent)] active:shadow-[inset_0_0_0_100px_color-mix(in_oklab,var(--color-ink)_12%,transparent)]"

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium whitespace-nowrap outline-hidden select-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-45 data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    pressable,
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        outline: "border-border bg-surface text-ink",
        secondary: "bg-secondary text-secondary-foreground",
        ghost: "bg-transparent text-ink-2",
        destructive: "bg-danger-soft text-danger",
        link: "text-primary underline-offset-4 hover:underline hover:shadow-none active:shadow-none",
      },
      size: {
        default: "gap-1.5 px-3.5 py-2",
        sm: "gap-1 px-2.5 py-1",
        xs: "gap-1 rounded-md px-2 py-0.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        lg: "gap-2 px-4 py-2.5",
        icon: "size-8 [&_svg:not([class*='size-'])]:size-4.5",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 rounded-md",
        "icon-lg": "size-9 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
