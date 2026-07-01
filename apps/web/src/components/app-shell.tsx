import { Badge } from "@dollarcast/ui";
import { Activity, BarChart3, CloudSun, Database, Settings, WalletCards } from "lucide-react";
import Link from "next/link";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-white">
      <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-border bg-[#0b1016] p-5 lg:block">
        <Link href="/" className="block">
          <div className="text-3xl font-semibold tracking-normal">$cast</div>
          <div className="text-sm text-muted">Climate markets</div>
        </Link>
        <nav className="mt-8 space-y-2 text-sm">
          <Link className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-panel2" href="/"><CloudSun size={16} /> Climate Markets</Link>
          <Link className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-panel2" href="/allocation"><WalletCards size={16} /> Allocation</Link>
          <Link className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-panel2" href="/sources"><Database size={16} /> Sources</Link>
          <Link className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-panel2" href={{ pathname: "/status" }}><Activity size={16} /> Status</Link>
          <span className="flex items-center gap-3 rounded-md px-3 py-2 text-muted"><Settings size={16} /> Settings</span>
        </nav>
        <div className="absolute bottom-5 left-5 right-5">
          <Badge tone="warning">Read-only analytics</Badge>
        </div>
      </aside>
      <main className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 className="text-positive" size={20} />
              <input className="h-9 w-full rounded-md border border-border bg-panel px-3 text-sm outline-none md:w-80" placeholder="Search markets" />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
              <span id="last-refreshed">Last refreshed: live check</span>
              <Badge tone="positive">Live-data status</Badge>
              <label className="flex items-center gap-2">
                Budget
                <input className="h-9 w-24 rounded-md border border-border bg-panel px-2 text-white" defaultValue="100" />
              </label>
            </div>
          </div>
        </header>
        <div className="p-4 lg:p-6">{children}</div>
        <footer className="border-t border-border p-6 text-xs leading-5 text-muted">
          $cast is an independent analytics tool. Market data is sourced from Kalshi. $cast is not affiliated with, endorsed by, or sponsored by Kalshi. Forecasts and allocation estimates are probabilistic and may be wrong.
        </footer>
      </main>
    </div>
  );
}
