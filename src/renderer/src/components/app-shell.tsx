import { Library, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { useLibrary, useSettings } from "../lib/midad";
import { DevicesIndicator } from "./devices";
import { UpdateNotice } from "./updates";
import { Badge, cx } from "./ui";

const NavItem = ({ to, icon, label, count }: { to: string; icon: ReactNode; label: string; count?: number }) => (
  <NavLink
    to={to}
    end
    viewTransition
    className={({ isActive }) =>
      cx(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
        isActive ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface hover:text-ink",
      )
    }
  >
    {icon}
    <span className="flex-1">{label}</span>
    {count !== undefined && <span className="text-xs font-normal text-ink-3">{count}</span>}
  </NavLink>
);

export const AppShell = () => {
  const settings = useSettings();
  const library = useLibrary();
  const configured = Boolean(settings.data?.endpoint && settings.data.hasKey);

  return (
    <div className="flex h-full">
      <aside className="flex w-62 shrink-0 flex-col gap-1 border-r border-line bg-surface-2 px-4 py-6 [view-transition-name:app-nav]">
        <div className="mb-5 flex items-baseline gap-2 px-2.5">
          <span className="ar text-ar-body font-bold text-accent">مداد</span>
          <span className="text-heading font-semibold">Midad</span>
        </div>
        <NavItem to="/" icon={<Library className="size-4.5" />} label="Library" count={library.data?.length} />
        <div className="flex-1" />
        <NavItem to="/settings" icon={<Settings className="size-4.5" />} label="Settings" />
        <div className="mt-3 flex flex-col gap-1.5 border-t border-line px-2.5 pt-4">
          {configured ? (
            <Badge tone="ok" dot>
              Corpus connected
            </Badge>
          ) : (
            <Badge tone="warn" dot>
              Corpus not set up
            </Badge>
          )}
          <span className="text-xs text-ink-3">
            {library.data ? `${library.data.length} ${library.data.length === 1 ? "book" : "books"} imported` : " "}
          </span>
        </div>
        <div className="mt-3 empty:hidden">
          <UpdateNotice placement="sidebar" />
        </div>
        <div className="mt-2 empty:hidden">
          <DevicesIndicator placement="sidebar" />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
};
