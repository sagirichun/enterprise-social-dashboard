"use client";

import { useCallback, useEffect, useState } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { BarChart3, Users, Heart, Eye } from "lucide-react";
import Card from "../../../components/ui/Card";
import PlatformIcon from "../../../components/dashboard/PlatformIcon";
import { slugFromEnum, type PlatformSlug } from "../../../lib/platforms";
import { useTheme } from "../../../components/providers/ThemeProvider";
import { useT } from "../../../lib/i18n/LanguageProvider";
import { cn } from "../../../lib/utils";

interface AccountSummary {
  id: string;
  platform: string;
  profileName?: string | null;
  profileUsername?: string | null;
  profileImage?: string | null;
  isActive: boolean;
  latest: {
    date: string;
    followers: number;
    engagement: number;
    impressions: number;
    clicks: number;
  } | null;
}

interface AnalyticsData {
  accounts: AccountSummary[];
  totals: { followers: number; engagement: number; impressions: number };
  series: { date: string; followers: number; engagement: number; impressions: number }[];
  days: number;
}

const DAY_OPTIONS = [7, 30, 90];

function formatCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export default function AnalyticsPage() {
  const t = useT();
  const { theme } = useTheme();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?days=${d}`);
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const hasData = data && (data.series.length > 0 || data.accounts.some((a) => a.latest));
  const dark = theme === "dark";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{t("analytics.title")}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t("analytics.subtitle")}
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                days === d ? "bg-indigo-600 text-white" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/60" />
          <div className="h-80 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/60" />
        </div>
      ) : !hasData ? (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <BarChart3 size={26} />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t("analytics.emptyTitle")}</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            {data && data.accounts.length === 0
              ? t("analytics.emptyNoAccounts")
              : t("analytics.emptyWaiting")}
          </p>
        </Card>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { label: t("analytics.totalFollowers"), value: data!.totals.followers, Icon: Users, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-500/15 dark:text-indigo-300" },
              { label: t("analytics.engagement"), value: data!.totals.engagement, Icon: Heart, tone: "text-rose-600 bg-rose-50 dark:bg-rose-500/15 dark:text-rose-300" },
              { label: t("analytics.impressions"), value: data!.totals.impressions, Icon: Eye, tone: "text-sky-600 bg-sky-50 dark:bg-sky-500/15 dark:text-sky-300" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
                <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", s.tone)}>
                  <s.Icon size={20} />
                </span>
                <span>
                  <span className="tnum block text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatCompact(s.value)}
                  </span>
                  <span className="text-[13px] text-zinc-500 dark:text-zinc-400">{s.label}</span>
                </span>
              </div>
            ))}
          </div>

          {/* Series */}
          <Card title={t("analytics.growthTitle")} subtitle={t("analytics.growthSubtitle", { days })}>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data!.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={dark ? "#27272a" : "#f4f4f5"} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: dark ? "#a1a1aa" : "#71717a" }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: dark ? "#a1a1aa" : "#71717a" }}
                    tickFormatter={(v: number) => formatCompact(v)}
                    width={48}
                  />
                  <Tooltip
                    formatter={(value: unknown, name: unknown) => [
                      (Number(value) || 0).toLocaleString(),
                      String(name).charAt(0).toUpperCase() + String(name).slice(1),
                    ]}
                    labelFormatter={(v: string) => v}
                    contentStyle={{
                      borderRadius: 10,
                      border: dark ? "1px solid #3f3f46" : "1px solid #e4e4e7",
                      background: dark ? "#18181b" : "#ffffff",
                      color: dark ? "#f4f4f5" : "#18181b",
                      fontSize: 12,
                    }}
                  />
                  <Area type="monotone" dataKey="followers" stroke="#6366f1" strokeWidth={2.5} fill="#6366f1" fillOpacity={0.08} />
                  <Area type="monotone" dataKey="impressions" stroke="#0ea5e9" strokeWidth={2} fill="#0ea5e9" fillOpacity={0.05} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Per-account table */}
          <Card title={t("analytics.accountsTitle")} subtitle={t("analytics.accountsSubtitle")} padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                    <th className="px-5 py-3">{t("analytics.colAccount")}</th>
                    <th className="px-5 py-3">{t("analytics.colPlatform")}</th>
                    <th className="px-5 py-3 text-right">{t("analytics.colFollowers")}</th>
                    <th className="px-5 py-3 text-right">{t("analytics.colEngagement")}</th>
                    <th className="px-5 py-3 text-right">{t("analytics.colImpressions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                  {data!.accounts.map((a) => {
                    const slug: PlatformSlug | null = slugFromEnum(a.platform);
                    return (
                      <tr key={a.id} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/60">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            {a.profileImage ? (
                              <img src={a.profileImage} alt="" className="h-8 w-8 rounded-full object-cover" />
                            ) : (
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">
                                {(a.profileName ?? "?").charAt(0).toUpperCase()}
                              </span>
                            )}
                            <span>
                              <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                                {a.profileName ?? a.profileUsername ?? t("analytics.unnamed")}
                              </span>
                              {a.profileUsername && (
                                <span className="block text-xs text-zinc-400 dark:text-zinc-500">@{a.profileUsername}</span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          {slug ? (
                            <PlatformIcon platform={slug} size="sm" showLabel />
                          ) : (
                            <span className="text-zinc-600 dark:text-zinc-400">{a.platform}</span>
                          )}
                        </td>
                        <td className="tnum px-5 py-3.5 text-right font-medium text-zinc-900 dark:text-zinc-100">
                          {a.latest ? a.latest.followers.toLocaleString() : "—"}
                        </td>
                        <td className="tnum px-5 py-3.5 text-right text-zinc-600 dark:text-zinc-400">
                          {a.latest ? a.latest.engagement.toLocaleString() : "—"}
                        </td>
                        <td className="tnum px-5 py-3.5 text-right text-zinc-600 dark:text-zinc-400">
                          {a.latest ? a.latest.impressions.toLocaleString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
