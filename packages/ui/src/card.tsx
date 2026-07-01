import * as React from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-border bg-panel p-4 shadow-sm", className)} {...props} />;
}

export function Stat({ label, value, tone = "default" }: { label: string; value: React.ReactNode; tone?: "default" | "positive" | "negative" | "warning" }) {
  const toneClass = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : tone === "warning" ? "text-warning" : "text-white";
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn("mt-1 truncate text-lg font-semibold", toneClass)}>{value}</div>
    </div>
  );
}
