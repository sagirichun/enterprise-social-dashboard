"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Users,
  CalendarClock,
  Zap,
  Radio,
  Sparkles,
  BarChart3,
  Settings,
  ShieldCheck,
  LifeBuoy,
  LogOut,
  X,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n/LanguageProvider";

const navItems = [
  { labelKey: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "nav.accounts", href: "/dashboard/accounts", icon: Users },
  { labelKey: "nav.scheduler", href: "/dashboard/scheduler", icon: CalendarClock },
  { labelKey: "nav.media", href: "/dashboard/media", icon: ImageIcon },
  { labelKey: "nav.automation", href: "/dashboard/automation", icon: Zap },
  { labelKey: "nav.live", href: "/dashboard/live", icon: Radio },
  { labelKey: "nav.aiStudio", href: "/dashboard/ai-studio", icon: Sparkles },
  { labelKey: "nav.analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { labelKey: "nav.settings", href: "/dashboard/settings", icon: Settings },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const t = useT();
  const userName = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? t("nav.admin");
  const userEmail = session?.user?.email ?? "";
  const initial = (userName.charAt(0) || "A").toUpperCase();

  return (
    <>
      {/* User card */}
      <div className="px-4 pt-5">
        <div className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">
              {userName}
            </span>
            <span className="block truncate text-xs text-zinc-500">
              {userEmail}
            </span>
          </span>
          <span
            className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300"
            title={t("nav.admin")}
          >
            <ShieldCheck size={11} />
            {t("nav.admin")}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3 py-6">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
          {t("nav.workspace")}
        </p>
        {navItems.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          const label = t(item.labelKey);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => onNavigate?.()}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-indigo-500" />
              )}
              <Icon
                size={17}
                className={cn(
                  "shrink-0",
                  active ? "text-indigo-300" : "text-zinc-500 group-hover:text-zinc-300"
                )}
              />
              {label}
              {item.labelKey === "nav.automation" && (
                <span className="ml-auto rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                  AI
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 px-3 py-3">
        <Link
          href="/dashboard/settings"
          onClick={() => onNavigate?.()}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
        >
          <LifeBuoy size={16} />
          {t("nav.helpDocs")}
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
        >
          <LogOut size={16} />
          {t("nav.signOut")}
        </button>
      </div>
    </>
  );
}

export default function Sidebar() {
  return (
    <aside className="sidebar-scroll fixed inset-y-0 left-0 z-40 hidden w-64 flex-col overflow-y-auto bg-zinc-950 lg:flex">
      <SidebarContent />
    </aside>
  );
}

export function MobileSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <div
      className={cn("fixed inset-0 z-50 lg:hidden", !open && "pointer-events-none")}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/60 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0"
        )}
      />
      {/* Panel */}
      <aside
        className={cn(
          "sidebar-scroll absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-4 pt-4">
          <p className="text-sm font-semibold text-white">{t("nav.menu")}</p>
          <button
            onClick={onClose}
            aria-label={t("nav.closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <SidebarContent onNavigate={onClose} />
      </aside>
    </div>
  );
}
