import * as React from "react";
import { cn } from "./cn";

export function Badge({ className, tone = "default", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "default" | "positive" | "negative" | "warning" | "source" }) {
  const toneClass =
    tone === "positive"
      ? "border-positive/40 bg-positive/10 text-positive"
      : tone === "negative"
        ? "border-negative/40 bg-negative/10 text-negative"
        : tone === "warning"
          ? "border-warning/40 bg-warning/10 text-warning"
          : tone === "source"
            ? "border-source/40 bg-source/10 text-source"
            : "border-border bg-panel2 text-muted";
  return <span className={cn("inline-flex items-center rounded-md border px-2 py-1 text-xs", toneClass, className)} {...props} />;
}
