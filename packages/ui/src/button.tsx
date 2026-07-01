import * as React from "react";
import { cn } from "./cn";

export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-panel2 px-3 text-sm text-white hover:border-source disabled:opacity-50", className)}
      {...props}
    />
  );
}
