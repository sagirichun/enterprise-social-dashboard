"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Plus,
  Unlink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Users,
  X as XIcon,
} from "lucide-react";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import PlatformIcon from "../../../components/dashboard/PlatformIcon";
import {
  PLATFORM_META,
  PLATFORM_SLUGS,
  slugFromEnum,
  type PlatformSlug,
} from "../../../lib/platforms";
import { useT } from "../../../lib/i18n/LanguageProvider";

interface ApiAccount {
  id: string;
  platform: string;
  providerAccountId: string;
  profileName?: string | null;
  profileUsername?: string | null;
  profileImage?: string | null;
  scopes: string[];
  isActive: boolean;
  lastSyncAt?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
}

type ConnStatus = "connected" | "expired" | "disconnected";

function connStatus(a: ApiAccount): ConnStatus {
  if (!a.isActive) return "disconnected";
  if (a.expiresAt && new Date(a.expiresAt).getTime() < Date.now()) return "expired";
  return "connected";
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 h-64" />}>
      <AccountsInner />
    </Suspense>
  );
}

function AccountsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useT();
  const [list, setList] = useState<ApiAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const statusMeta: Record<ConnStatus, { tone: "success" | "warning" | "danger"; labelKey: string; Icon: typeof CheckCircle2 }> = {
    connected: { tone: "success", labelKey: "accounts.statusConnected", Icon: CheckCircle2 },
    expired: { tone: "warning", labelKey: "accounts.statusExpired", Icon: AlertTriangle },
    disconnected: { tone: "danger", labelKey: "accounts.statusDisconnected", Icon: XCircle },
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      setList(Array.isArray(json.accounts) ? json.accounts : []);
    } catch {
      setNotice({ tone: "danger", text: t("accounts.loadError") });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // OAuth callback feedback (?connected= / ?error=)
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected) {
      const label = PLATFORM_META[connected as PlatformSlug]?.label ?? connected;
      setNotice({ tone: "success", text: t("accounts.connectedSuccess", { label }) });
      load();
    } else if (error) {
      const friendly =
        error.endsWith("_not_configured")
          ? t("accounts.oauthNotConfigured")
          : error === "no_profiles_found"
            ? t("accounts.noProfiles")
            : t("accounts.connectFailed", { error });
      setNotice({ tone: "danger", text: friendly });
    }
    if (connected || error) {
      router.replace("/dashboard/accounts");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setList((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setNotice({ tone: "danger", text: t("accounts.disconnectError") });
    } finally {
      setBusyId(null);
    }
  };

  const connectPlatform = (slug: PlatformSlug) => {
    window.location.href = `/api/oauth/${slug}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {t("accounts.title")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {loading ? t("common.loading") : t("accounts.countLine", { count: list.length })}
          </p>
        </div>
        <Button icon={<Plus size={15} />} onClick={() => setPickerOpen(true)}>
          {t("accounts.connectAccount")}
        </Button>
      </div>

      {notice && (
        <div
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
          }`}
        >
          <p>{notice.text}</p>
          <button
            onClick={() => setNotice(null)}
            aria-label={t("common.dismiss")}
            className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/60" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Users size={26} />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t("accounts.noAccountsTitle")}</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            {t("accounts.noAccountsBody")}
          </p>
          <Button icon={<Plus size={15} />} className="mt-6" onClick={() => setPickerOpen(true)}>
            {t("accounts.connectFirst")}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => {
            const slug = slugFromEnum(a.platform);
            const status = connStatus(a);
            const meta = statusMeta[status];
            const MetaIcon = meta.Icon;
            const name = a.profileName || a.profileUsername || t("common.unknown");
            return (
              <Card key={a.id} className="animate-fade-up">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    {a.profileImage ? (
                      <img
                        src={a.profileImage}
                        alt={name}
                        className="h-11 w-11 rounded-xl object-cover"
                      />
                    ) : (
                      slug && <PlatformIcon platform={slug} size="lg" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">{name}</p>
                      <p className="truncate text-[13px] text-zinc-500 dark:text-zinc-400">
                        {a.profileUsername ? `@${a.profileUsername}` : slug ? PLATFORM_META[slug].label : a.platform}
                      </p>
                    </div>
                  </div>
                  <Badge tone={meta.tone}>
                    <MetaIcon size={12} />
                    {t(meta.labelKey)}
                  </Badge>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2 border-t border-zinc-100 pt-4 text-[13px] dark:border-zinc-800">
                  <div>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("accounts.platform")}</p>
                    <p className="font-medium capitalize text-zinc-800 dark:text-zinc-200">
                      {slug ? PLATFORM_META[slug].label : a.platform}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("accounts.connectedOn")}</p>
                    <p className="font-medium text-zinc-800 dark:text-zinc-200">{formatDate(a.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("accounts.token")}</p>
                    <p className="font-medium text-zinc-800 dark:text-zinc-200">
                      {status === "connected" ? t("accounts.tokenValid") : status === "expired" ? t("accounts.tokenExpired") : t("accounts.tokenRevoked")}
                      {a.hasRefreshToken ? ` · ${t("accounts.autoRefresh")}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("accounts.lastSync")}</p>
                    <p className="font-medium text-zinc-800 dark:text-zinc-200">{formatDate(a.lastSyncAt)}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  {status === "connected" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => disconnect(a.id)}
                      disabled={busyId === a.id}
                      icon={<Unlink size={13} />}
                      className="w-full text-zinc-500 dark:text-zinc-400"
                    >
                      {busyId === a.id ? t("accounts.disconnecting") : t("accounts.disconnect")}
                    </Button>
                  ) : (
                    slug && (
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => connectPlatform(slug)}
                      >
                        {t("accounts.reconnect")}
                      </Button>
                    )
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Platform picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setPickerOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl dark:bg-zinc-900">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t("accounts.pickerTitle")}</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {t("accounts.pickerSubtitle")}
                </p>
              </div>
              <button
                onClick={() => setPickerOpen(false)}
                aria-label={t("common.close")}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <XIcon size={18} />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PLATFORM_SLUGS.map((slug) => (
                <button
                  key={slug}
                  onClick={() => connectPlatform(slug)}
                  className="flex items-center gap-3 rounded-xl border border-zinc-200 p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-zinc-700 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-500/10"
                >
                  <PlatformIcon platform={slug} size="lg" />
                  <span>
                    <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {PLATFORM_META[slug].label}
                    </span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {PLATFORM_META[slug].blurb}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
