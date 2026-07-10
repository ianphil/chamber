import * as React from "react"

import { cn } from "@/renderer/lib/utils"

// Placeholder box for content that is still loading. Reserves layout space so
// panels don't jump when real data arrives. Uses `bg-foreground/10` (not
// `bg-muted`) because Chamber maps `--color-muted` to the solid foreground
// color; a low-opacity foreground tint reads as a subtle gray in both light
// and dark mode. The pulse is disabled automatically under
// prefers-reduced-motion via the global rule in index.css.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-foreground/10", className)}
      {...props}
    />
  )
}

export { Skeleton }
