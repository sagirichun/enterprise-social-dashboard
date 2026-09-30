"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Users,
  CalendarClock,
  Inbox,
  CheckCircle2,
  ArrowUpRight,
  Clock3,
  Plug,
} from "lucide-react";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import StatCard from "../../components/dashboard/StatCard";
import PlatformIcon from "../../components/dashboard/PlatformIcon";
import SentimentBadge from "../../components/dashboard/SentimentBadge";
import { slugFromEnum, type PlatformSlug } from "../../lib/platforms";
import { useT } from "../../lib/i18n/LanguageProvider";

interface OverviewState {
  accountCount: number;
  queuedPosts: number;
  publishedWeek: number;
  unreplied: number;
  upcoming: {
    id: string;
    content: string;
    platforms: string[];
    scheduledAt: string | null;
    status: string;
  }[];
  inboxPreview: {
    id: string;
    platform: string;
    authorName?: string | null;
    text: string;
    sentiment?: string | null;
    createdAt: string;
  }[];
}

function greetingKey() {
  const h = new Date().getHours();
  if (h < 11) return "overview.greetingMorning";
  if (h < 15) return "overview.greetingAfternoon";
  if (h < 19) return "overview.greetingEvening";
  return "overview.greetingNight";
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const t = useT();
  const [state, setState] = useState<OverviewState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [accountsRes, postsRes, inboxRes] = await Promise.all([
          fetch("/api/accounts"),
          fetch("/api/posts?pageSize=50"),
          fetch("/api/automation/inbox?pageSize=5&replied=false"),
        ]);
        const accountsJson = await accountsRes.json();
        const postsJson = await postsRes.json();
        const inboxJson = await inboxRes.json();

        const accounts = Array.isArray(accountsJson.accounts) ? accountsJson.accounts : [];
        const posts = Array.isArray(postsJson.posts) ? postsJson.posts : [];
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

        setState({
          accountCount: accounts.filter((a: { isActive: boolean }) => a.isActive).length,
          queuedPosts: posts.filter((p: { status: string }) =>
            ["DRAFT", "QUEUED", "PUBLISHING"].includes(p.status)
          ).length,
          publishedWeek: posts.filter(
            (p: { status: string; publishedAt?: string | null }) =>
              p.status === "PUBLISHED" && p.publishedAt && new Date(p.publishedAt).getTime() >= weekAgo
          ).length,
          unreplied: inboxJson.unrepliedCount ?? 0,
          upcoming: posts
            .filter((p: { status: string }) => ["QUEUED", "PUBLISHING", "DRAFT"].includes(p.status))
            .slice(0, 5),
          inboxPreview: Array.isArray(inboxJson.comments) ? inboxJson.comments.slice(0, 4) : [],
        });
      } catch {
        setState(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const userName = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "there";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {t(greetingKey())}, {userName}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {today} — {t("overview.subtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/scheduler">
            <Button variant="secondary" icon={<CalendarClock size={15} />}>
              {t("overview.viewQueue")}
            </Button>
          </Link>
          <Link href="/dashboard/scheduler">
            <Button icon={<ArrowUpRight size={15} />}>{t("overview.newPost")}</Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/60" />
          ))}
        </div>
      ) : state && state.accountCount === 0 ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Plug size={26} />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {t("overview.emptyTitle")}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            {t("overview.emptyBody")}
          </p>
          <Link href="/dashboard/accounts" className="mt-6">
            <Button icon={<ArrowUpRight size={15} />}>{t("overview.connectAccount")}</Button>
          </Link>
        </Card>
      ) : (
        state && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={t("overview.statAccounts")}
                value={String(state.accountCount)}
                icon={Users}
                hint={t("overview.hintAccounts")}
              />
              <StatCard
                label={t("overview.statQueue")}
                value={String(state.queuedPosts)}
                icon={CalendarClock}
                hint={t("overview.hintQueue")}
              />
              <StatCard
                label={t("overview.statPublished")}
                value={String(state.publishedWeek)}
                icon={CheckCircle2}
                hint={t("overview.hintPublished")}
              />
              <StatCard
                label={t("overview.statUnreplied")}
                value={String(state.unreplied)}
                icon={Inbox}
                hint={t("overview.hintUnreplied")}
              />
            </div>

            {/* Tables row */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card
                title={t("overview.upcomingTitle")}
                subtitle={t("overview.upcomingSubtitle")}
                className="xl:col-span-2"
                padded={false}
                action={
                  <Link href="/dashboard/scheduler">
                    <Button variant="ghost" size="sm">
                      {t("common.viewAll")}
                    </Button>
                  </Link>
                }
              >
                {state.upcoming.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">
                    {t("overview.upcomingEmpty")}{" "}
                    <Link href="/dashboard/scheduler" className="font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">
                      {t("overview.composePost")}
                    </Link>{" "}
                    {t("overview.upcomingEmptySuffix")}
                  </p>
                ) : (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {state.upcoming.map((post) => (
                      <li key={post.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/60">
                        <div className="flex -space-x-1.5">
                          {post.platforms.slice(0, 3).map((p) => {
                            const slug: PlatformSlug | null = slugFromEnum(p);
                            return (
                              <span key={p} className="rounded-full ring-2 ring-white dark:ring-zinc-900">
                                {slug && <PlatformIcon platform={slug} size="sm" />}
                              </span>
                            );
                          })}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-medium text-zinc-900 dark:text-zinc-100">
                            {post.content}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
                            <Clock3 size={12} />
                            {post.scheduledAt
                              ? new Date(post.scheduledAt).toLocaleString(undefined, {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : t("overview.noSchedule")}
                          </p>
                        </div>
                        <Badge
                          tone={
                            post.status === "PUBLISHING"
                              ? "info"
                              : post.status === "QUEUED"
                                ? "warning"
                                : "indigo"
                          }
                          dot={post.status === "PUBLISHING"}
                        >
                          <span className="capitalize">{post.status.toLowerCase()}</span>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card
                title={t("overview.inboxTitle")}
                subtitle={t("overview.inboxSubtitle")}
                padded={false}
                action={
                  <Link href="/dashboard/automation">
                    <Button variant="ghost" size="sm">
                      {t("overview.openInbox")}
                    </Button>
                  </Link>
                }
              >
                {state.inboxPreview.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">
                    {t("overview.inboxEmpty")}
                  </p>
                ) : (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {state.inboxPreview.map((m) => {
                      const slug: PlatformSlug | null = slugFromEnum(m.platform);
                      return (
                        <li key={m.id} className="px-5 py-3.5 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/60">
                          <div className="flex items-center gap-2.5">
                            {slug && <PlatformIcon platform={slug} size="xs" />}
                            <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                              {m.authorName ?? t("common.unknown")}
                            </p>
                            <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-500">
                              {new Date(m.createdAt).toLocaleDateString(undefined, {
                                day: "2-digit",
                                month: "short",
                              })}
                            </span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                            {m.text}
                          </p>
                          <div className="mt-2">
                            {m.sentiment && (
                              <SentimentBadge
                                sentiment={m.sentiment.toLowerCase() as "positive" | "neutral" | "negative"}
                              />
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>
          </>
        )
      )}
    </div>
  );
}
