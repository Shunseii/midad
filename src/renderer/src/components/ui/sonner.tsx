import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Midad toasts are an inverted pill (ink on paper flipped) centred above the bottom edge.
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="system"
    position="bottom-center"
    offset={32}
    gap={8}
    className="toaster group"
    icons={{
      success: <CircleCheckIcon className="size-4" />,
      info: <InfoIcon className="size-4" />,
      warning: <TriangleAlertIcon className="size-4" />,
      error: <OctagonXIcon className="size-4" />,
      loading: <Loader2Icon className="size-4 animate-spin" />,
    }}
    style={
      {
        "--normal-bg": "var(--color-ink)",
        "--normal-text": "var(--color-bg)",
        "--normal-border": "var(--color-ink)",
        "--border-radius": "var(--radius-lg)",
      } as React.CSSProperties
    }
    toastOptions={{
      classNames: {
        toast: "cn-toast",
      },
    }}
    {...props}
  />
)

export { Toaster }
