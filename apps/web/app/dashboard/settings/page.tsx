"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ShieldAlert, Sparkles, Server, ArrowUpRight, Loader2 } from "lucide-react";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import Input from "../../../components/ui/Input";
import Badge from "../../../components/ui/Badge";
import { useT } from "../../../lib/i18n/LanguageProvider";

interface MeUser {
  id: string;
  email: string;
  name?: string | null;
  plan: string;
  createdAt: string;
}

export default function SettingsPage() {
  const t = useT();
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiProvider, setAiProvider] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  useEffect(() => {
    (async () => {
      try {
        const [meRes, aiRes] = await Promise.all([
          fetch("/api/users/me"),
          fetch("/api/ai/config"),
        ]);
        const meJson = await meRes.json();
        const aiJson = await aiRes.json();
        if (meRes.ok) {
          setUser(meJson.user);
          setName(meJson.user.name ?? "");
        }
        if (aiRes.ok && aiJson.config) {
          setAiProvider(aiJson.config.provider ?? null);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveProfile = async () => {
    if (!name.trim()) {
      showToast(t("settings.nameEmpty"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? t("settings.saveError"));
        return;
      }
      setUser(json.user);
      showToast(t("settings.saved"));
    } catch {
      showToast(t("common.networkError"));
    } finally {
      setSaving(false);
    }
  };

  const deleteEverything = async () => {
    const confirmed = window.confirm(t("settings.deleteConfirm1"));
    if (!confirmed) return;
    const doubleCheck = window.prompt(t("settings.deleteConfirm2"));
    if (doubleCheck !== "DELETE") return;
    setDeleting(true);
    try {
      const res = await fetch("/api/users/me", { method: "DELETE" });
      if (!res.ok) {
        showToast(t("settings.deleteError"));
        setDeleting(false);
        return;
      }
      await signOut({ callbackUrl: "/login" });
    } catch {
      showToast(t("common.networkError"));
      setDeleting(false);
    }
  };

  const initial = ((user?.name ?? user?.email ?? "A").charAt(0) || "A").toUpperCase();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t("settings.subtitle")}
        </p>
      </div>

      {/* Profile */}
      <Card title={t("settings.profileTitle")} subtitle={t("settings.profileSubtitle")}>
        {loading ? (
          <div className="h-32 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
        ) : (
          <>
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-base font-semibold text-white">
                {initial}
              </span>
              <div>
                <p className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">{user?.name ?? "—"}</p>
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{user?.email}</p>
              </div>
              <span className="ml-auto">
                <Badge tone="success">{t("settings.administrator")}</Badge>
              </span>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t("settings.fullName")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("settings.namePlaceholder")}
              />
              <Input label={t("settings.email")} value={user?.email ?? ""} type="email" disabled />
            </div>
            <div className="mt-5 flex justify-end border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <Button onClick={saveProfile} disabled={saving}>
                {saving ? t("settings.saving") : t("settings.saveChanges")}
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* AI provider */}
      <Card
        title={t("settings.aiTitle")}
        subtitle={t("settings.aiSubtitle")}
        action={<Sparkles size={16} className="text-zinc-400 dark:text-zinc-500" />}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {aiProvider ? (
              <>
                {t("settings.aiCurrent")}{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{aiProvider}</span>.
                {" "}{t("settings.aiKeysNote")}
              </>
            ) : (
              t("settings.aiEmpty")
            )}
          </p>
          <Link href="/dashboard/ai-studio" className="shrink-0">
            <Button variant="secondary" size="sm" icon={<ArrowUpRight size={13} />}>
              {t("settings.openAiStudio")}
            </Button>
          </Link>
        </div>
      </Card>

      {/* Server */}
      <Card
        title={t("settings.serverTitle")}
        subtitle={t("settings.serverSubtitle")}
        action={<Server size={16} className="text-zinc-400 dark:text-zinc-500" />}
      >
        <dl className="grid grid-cols-1 gap-3 text-sm">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{t("settings.hosting")}</dt>
            <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">{t("settings.hostingValue")}</dd>
          </div>
        </dl>
      </Card>

      {/* Danger zone */}
      <Card title={t("settings.dangerTitle")} className="border-rose-200 dark:border-rose-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-rose-50/60 p-4 dark:bg-rose-500/10">
          <div className="flex items-start gap-3">
            <ShieldAlert size={17} className="mt-0.5 shrink-0 text-rose-500" />
            <div>
              <p className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">{t("settings.dangerHead")}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("settings.dangerBody")}
              </p>
            </div>
          </div>
          <Button variant="danger" size="sm" onClick={deleteEverything} disabled={deleting}>
            {deleting ? (
              <span className="flex items-center gap-2">
                <Loader2 size={13} className="animate-spin" /> {t("settings.deleting")}
              </span>
            ) : (
              t("settings.deleteEverything")
            )}
          </Button>
        </div>
      </Card>

      {toast && (
        <div className="animate-fade-up fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-pop dark:bg-zinc-100 dark:text-zinc-900">
          {toast}
        </div>
      )}
    </div>
  );
}
