import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm text-ink transition-[border-color,box-shadow] outline-hidden [unicode-bidi:plaintext] placeholder:text-ink-3 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger-soft",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
