"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  Bell,
  Plus,
  ChevronDown,
  Menu,
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "../providers/ThemeProvider";
import { useLanguage, useT } from "../../lib/i18n/LanguageProvider";
import { cn } from "../../lib/utils";

interface Notice {
  id: string;
  title: string;
  body: string;
  tone: "alert" | "info" | "ok";
}

const toneIcon = {
  alert: <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-500" />,
  info: <MessageSquare size={15} className="mt-0.5 shrink-0 text-indigo-500" />,
  ok: <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />,
};

function LanguageToggle() {
  const { lang, setLang } = useLanguage();
  const t = useT();
  return (
    <div
      className="flex h-9 items-center rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900"
      role="group"
      aria-label={t("common.language")}
      title={t("common.language")}
    >
      {(["id", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={cn(
            "flex h-7 items-center rounded-md px-2.5 text-xs font-semibold uppercase tracking-wide transition-colors",
            lang === l
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export default function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();
  const t = useT();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loadingNotices, setLoadingNotices] = useState(false);

  useEffect(() => {
    if (!showNotifications) return;
    (async () => {
      setLoadingNotices(true);
      try {
        const [failedRes, inboxRes, postsRes] = await Promise.all([
          fetch("/api/posts?status=FAILED"),
          fetch("/api/automation/inbox?status=PENDING"),
          fetch("/api/posts?status=PUBLISHED"),
        ]);
        const items: Notice[] = [];
        if (failedRes.ok) {
          const j = await failedRes.json();
          const failed: any[] = j.posts ?? [];
          failed.slice(0, 3).forEach((p) =>
            items.push({
              id: `fail-${p.id}`,
              title: t("topbar.failedTitle"),
              body: `${(p.content ?? "").slice(0, 60)}${(p.content ?? "").length > 60 ? "…" : ""} — ${p.error ?? t("topbar.unknownError")}`,
              tone: "alert",
            })
          );
        }
        if (inboxRes.ok) {
          const j = await inboxRes.json();
          const pending: any[] = j.comments ?? [];
          if (pending.length > 0) {
            items.push({
              id: "inbox-pending",
              title: t("topbar.inboxTitle"),
              body: t("topbar.inboxBody", { count: pending.length }),
              tone: "info",
            });
          }
        }
        if (postsRes.ok) {
          const j = await postsRes.json();
          const published: any[] = j.posts ?? [];
          if (published.length > 0) {
            const p = published[0];
            items.push({
              id: `pub-${p.id}`,
              title: t("topbar.publishedTitle"),
              body: `${(p.content ?? "").slice(0, 60)}${(p.content ?? "").length > 60 ? "…" : ""}`,
              tone: "ok",
            });
          }
        }
        setNotices(items);
      } catch {
        /* ignore */
      } finally {
        setLoadingNotices(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNotifications]);

  const name = session?.user?.name ?? session?.user?.email ?? t("nav.admin");
  const initial = (name.charAt(0) || "A").toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/85">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        {/* Mobile menu button */}
        <button
          onClick={onMenuClick}
          aria-label={t("nav.openMenu")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <Menu size={20} />
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* Language */}
          <LanguageToggle />

          {/* Theme */}
          <button
            onClick={toggleTheme}
            aria-label={theme === "light" ? t("common.switchToDark") : t("common.switchToLight")}
            title={t("common.theme")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          <Link
            href="/dashboard/scheduler"
            className="hidden h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 sm:inline-flex"
          >
            <Plus size={16} />
            {t("topbar.create")}
          </Link>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications((v) => !v)}
              className="relative flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label={t("topbar.notifications")}
            >
              <Bell size={18} />
              {notices.length > 0 && (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-zinc-950" />
              )}
            </button>
            {showNotifications && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowNotifications(false)}
                />
                <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-pop dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {t("topbar.notifications")}
                    </p>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {loadingNotices ? (
                      <p className="px-4 py-6 text-center text-[13px] text-zinc-400 dark:text-zinc-500">
                        {t("topbar.loading")}
                      </p>
                    ) : notices.length === 0 ? (
                      <p className="px-4 py-6 text-center text-[13px] text-zinc-400 dark:text-zinc-500">
                        {t("topbar.empty")}
                      </p>
                    ) : (
                      notices.map((n) => (
                        <div
                          key={n.id}
                          className="flex items-start gap-2.5 border-b border-zinc-50 px-4 py-3 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                        >
                          {toneIcon[n.tone]}
                          <div>
                            <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                              {n.title}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{n.body}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* User */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu((v) => !v)}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
                {initial}
              </span>
              <span className="hidden text-left md:block">
                <span className="block max-w-[140px] truncate text-[13px] font-medium leading-tight text-zinc-900 dark:text-zinc-100">
                  {name}
                </span>
                <span className="block text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
                  {t("nav.admin")}
                </span>
              </span>
              <ChevronDown size={14} className="hidden text-zinc-400 md:block" />
            </button>
            {showUserMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowUserMenu(false)}
                />
                <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-pop dark:border-zinc-700 dark:bg-zinc-900">
                  <Link
                    href="/dashboard/settings"
                    onClick={() => setShowUserMenu(false)}
                    className="block px-4 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    {t("topbar.settings")}
                  </Link>
                  <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="block w-full px-4 py-2 text-left text-[13px] text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    {t("topbar.signOut")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
