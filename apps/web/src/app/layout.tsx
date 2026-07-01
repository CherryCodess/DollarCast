import { AppShell } from "@/components/app-shell";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "$cast",
  description: "Weather market intelligence."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
