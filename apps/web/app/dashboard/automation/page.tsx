"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  MessageCircle,
  Trash2,
  Inbox,
  Bot,
} from "lucide-react";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Modal from "../../../components/ui/Modal";
import Input from "../../../components/ui/Input";
import PlatformIcon from "../../../components/dashboard/PlatformIcon";
import SentimentBadge from "../../../components/dashboard/SentimentBadge";
import {
  PLATFORM_META,
  slugFromEnum,
  type PlatformSlug,
} from "../../../lib/platforms";
import { useT } from "../../../lib/i18n/LanguageProvider";
import { cn } from "../../../lib/utils";

interface ApiRule {
  id: string;
  name: string;
  accountId?: string | null;
  platform?: string | null;
  isEnabled: boolean;
  promptTemplate: string;
  replyDelaySec: number;
  sentimentFilter: string[];
  keywordFilter: string[];
  maxRepliesPerDay: number;
  createdAt: string;
  account?: { id: string; platform: string; profileName?: string | null } | null;
}

interface ApiComment {
  id: string;
  platform: string;
  externalId: string;
  authorName?: string | null;
  authorAvatar?: string | null;
  text: string;
  sentiment?: string | null;
  sentimentScore?: number | null;
  replied: boolean;
  replyText?: string | null;
  createdAt: string;
  account?: { id: string; platform: string; profileName?: string | null } | null;
}

interface ApiAccount {
  id: string;
  platform: string;
  profileName?: string | null;
  profileUsername?: string | null;
  isActive: boolean;
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        on ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-700",
        disabled && "opacity-50"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
          on ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}

export default function AutomationPage() {
  const t = useT();
  const [rules, setRules] = useState<ApiRule[]>([]);
  const [comments, setComments] = useState<ApiComment[]>([]);
  const [unrepliedCount, setUnrepliedCount] = useState(0);
  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inboxFilter, setInboxFilter] = useState<"all" | "unreplied" | "replied">("all");

  // New rule form
  const [formName, setFormName] = useState("");
  const [formAccountId, setFormAccountId] = useState("");
  const [formPrompt, setFormPrompt] = useState(
    "Reply helpfully and briefly to this {{platform}} comment from {{author}}: \"{{comment}}\""
  );
  const [formDelay, setFormDelay] = useState("60");
  const [formMaxPerDay, setFormMaxPerDay] = useState("50");
  const [formKeywords, setFormKeywords] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, inboxRes, accountsRes] = await Promise.all([
        fetch("/api/automation/rules"),
        fetch("/api/automation/inbox?pageSize=30"),
        fetch("/api/accounts"),
      ]);
      const rulesJson = await rulesRes.json();
      const inboxJson = await inboxRes.json();
      const accountsJson = await accountsRes.json();
      setRules(Array.isArray(rulesJson.rules) ? rulesJson.rules : []);
      setComments(Array.isArray(inboxJson.comments) ? inboxJson.comments : []);
      setUnrepliedCount(inboxJson.unrepliedCount ?? 0);
      setAccounts(
        (Array.isArray(accountsJson.accounts) ? accountsJson.accounts : []).filter(
          (a: ApiAccount) => a.isActive
        )
      );
    } catch {
      showToast(t("automation.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRule = async (id: string, current: boolean) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/automation/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !current }),
      });
      if (!res.ok) throw new Error();
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, isEnabled: !current } : r)));
    } catch {
      showToast(t("automation.updateError"));
    } finally {
      setBusyId(null);
    }
  };

  const deleteRule = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/automation/rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setRules((prev) => prev.filter((r) => r.id !== id));
      showToast(t("automation.ruleDeleted"));
    } catch {
      showToast(t("automation.deleteError"));
    } finally {
      setBusyId(null);
    }
  };

  const createRule = async () => {
    if (!formPrompt.trim()) {
      showToast(t("automation.promptEmpty"));
      return;
    }
    setBusyId("new");
    try {
      const res = await fetch("/api/automation/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim() || t("automation.defaultRuleName"),
          accountId: formAccountId || null,
          isEnabled: true,
          promptTemplate: formPrompt.trim(),
          replyDelaySec: Math.max(0, parseInt(formDelay || "60", 10)),
          maxRepliesPerDay: Math.max(1, parseInt(formMaxPerDay || "50", 10)),
          keywordFilter: formKeywords.split(",").map((k) => k.trim()).filter(Boolean),
          sentimentFilter: [],
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? t("automation.createError"));
        return;
      }
      setRules((prev) => [json.rule, ...prev]);
      setEditorOpen(false);
      setFormName("");
      setFormAccountId("");
      setFormKeywords("");
      showToast(t("automation.created"));
    } catch {
      showToast(t("common.networkError"));
    } finally {
      setBusyId(null);
    }
  };

  const visibleComments = comments.filter((c) =>
    inboxFilter === "all" ? true : inboxFilter === "replied" ? c.replied : !c.replied
  );

  const ruleScope = (r: ApiRule) => {
    if (r.account) {
      const slug = slugFromEnum(r.account.platform);
      return `${slug ? PLATFORM_META[slug].label : r.account.platform} · ${r.account.profileName ?? t("common.unknown").toLowerCase()}`;
    }
    if (r.platform) {
      const slug = slugFromEnum(r.platform);
      return slug ? t("automation.scopeAllPlatform", { label: PLATFORM_META[slug].label }) : r.platform;
    }
    return t("automation.scopeAll");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{t("automation.title")}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t("automation.subtitle")}
          </p>
        </div>
        <Button icon={<Plus size={15} />} onClick={() => setEditorOpen(true)}>
          {t("automation.newRule")}
        </Button>
      </div>

      {/* Rules */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/60" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Bot size={22} />
          </span>
          <h2 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">{t("automation.emptyTitle")}</h2>
          <p className="mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
            {t("automation.emptyBody")}
          </p>
          <Button icon={<Plus size={15} />} className="mt-5" onClick={() => setEditorOpen(true)}>
            {t("automation.createFirstRule")}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rules.map((rule) => (
            <Card key={rule.id} className="animate-fade-up">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    rule.isEnabled
                      ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
                      : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                  )}
                >
                  <MessageCircle size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">{rule.name}</p>
                    <Toggle
                      on={rule.isEnabled}
                      disabled={busyId === rule.id}
                      onChange={() => toggleRule(rule.id, rule.isEnabled)}
                    />
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {rule.promptTemplate}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 dark:text-zinc-500">
                    <Badge tone="neutral">{ruleScope(rule)}</Badge>
                    <span className="tnum">{t("automation.delayLabel", { seconds: rule.replyDelaySec })}</span>
                    <span>·</span>
                    <span className="tnum">{t("automation.maxPerDay", { count: rule.maxRepliesPerDay })}</span>
                    {rule.keywordFilter.length > 0 && (
                      <span className="tnum">{t("automation.keywords", { keywords: rule.keywordFilter.join(", ") })}</span>
                    )}
                    <button
                      onClick={() => deleteRule(rule.id)}
                      disabled={busyId === rule.id}
                      className="ml-auto rounded-lg p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                      aria-label={t("automation.deleteRule")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Inbox */}
      <Card
        title={t("automation.inboxTitle")}
        subtitle={t("automation.inboxSubtitle")}
        padded={false}
        action={
          <div className="flex items-center gap-2">
            {(["all", "unreplied", "replied"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setInboxFilter(f)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  inboxFilter === f
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                    : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                )}
              >
                {f === "all"
                  ? t("automation.filterAll")
                  : f === "unreplied"
                    ? t("automation.filterUnreplied", { count: unrepliedCount })
                    : t("automation.filterReplied")}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <div className="space-y-3 px-5 py-6">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
            ))}
          </div>
        ) : visibleComments.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
              <Inbox size={22} />
            </span>
            <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("automation.inboxEmptyTitle")}</p>
            <p className="mt-1 max-w-sm text-[13px] text-zinc-500 dark:text-zinc-400">
              {accounts.length === 0
                ? t("automation.inboxEmptyNoAccounts")
                : t("automation.inboxEmptyWaiting")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {visibleComments.map((c) => {
              const slug: PlatformSlug | null = slugFromEnum(c.platform);
              return (
                <li key={c.id} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    {c.authorAvatar ? (
                      <img src={c.authorAvatar} alt="" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">
                        {(c.authorName ?? "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                          {c.authorName ?? t("common.unknown")}
                        </p>
                        {slug && <PlatformIcon platform={slug} size="xs" />}
                        {c.sentiment && (
                          <SentimentBadge sentiment={c.sentiment.toLowerCase() as "positive" | "neutral" | "negative"} />
                        )}
                        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                          {new Date(c.createdAt).toLocaleString(undefined, {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="ml-auto">
                          {c.replied ? (
                            <Badge tone="success">{t("automation.repliedBadge")}</Badge>
                          ) : (
                            <Badge tone="warning">{t("automation.awaitingBadge")}</Badge>
                          )}
                        </span>
                      </div>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-zinc-700 dark:text-zinc-300">{c.text}</p>
                      {c.replied && c.replyText && (
                        <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-[13px] leading-relaxed text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-400">
                          <span className="font-medium text-zinc-800 dark:text-zinc-200">{t("automation.replySent")}</span>
                          {c.replyText}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Rule editor */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={t("automation.editorTitle")}
        subtitle={t("automation.editorSubtitle")}
        closeLabel={t("common.close")}
      >
        <div className="space-y-4">
          <Input
            label={t("automation.ruleName")}
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={t("automation.ruleNamePlaceholder")}
          />
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
              {t("automation.appliesTo")}
            </label>
            <select
              value={formAccountId}
              onChange={(e) => setFormAccountId(e.target.value)}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">{t("automation.allAccounts")}</option>
              {accounts.map((a) => {
                const slug = slugFromEnum(a.platform);
                return (
                  <option key={a.id} value={a.id}>
                    {slug ? PLATFORM_META[slug].label : a.platform} · {a.profileName || a.profileUsername || t("common.unknown").toLowerCase()}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
              {t("automation.replyPrompt")}
            </label>
            <textarea
              value={formPrompt}
              onChange={(e) => setFormPrompt(e.target.value)}
              rows={4}
              placeholder={t("automation.promptPlaceholder")}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              {t("automation.placeholdersHint")} {"{{comment}}"}, {"{{author}}"}, {"{{platform}}"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t("automation.delaySec")}
              type="number"
              min={0}
              value={formDelay}
              onChange={(e) => setFormDelay(e.target.value)}
            />
            <Input
              label={t("automation.maxPerDayLabel")}
              type="number"
              min={1}
              value={formMaxPerDay}
              onChange={(e) => setFormMaxPerDay(e.target.value)}
            />
          </div>
          <Input
            label={t("automation.keywordsLabel")}
            value={formKeywords}
            onChange={(e) => setFormKeywords(e.target.value)}
            placeholder={t("automation.keywordsPlaceholder")}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={createRule} disabled={busyId === "new"}>
              {busyId === "new" ? t("automation.creating") : t("automation.createRule")}
            </Button>
          </div>
        </div>
      </Modal>

      {toast && (
        <div className="animate-fade-up fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-pop dark:bg-zinc-100 dark:text-zinc-900">
          {toast}
        </div>
      )}
    </div>
  );
}
