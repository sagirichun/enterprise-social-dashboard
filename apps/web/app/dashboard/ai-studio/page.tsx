"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Copy,
  Check,
  Loader2,
  Plug,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  XCircle,
  CheckCircle2,
  Terminal,
  Wand2,
} from "lucide-react";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Input from "../../../components/ui/Input";
import { cn } from "../../../lib/utils";

type ProviderId = "OPENAI" | "ANTHROPIC" | "OLLAMA" | "LMSTUDIO" | "CUSTOM";

const providers: { id: ProviderId; name: string; description: string }[] = [
  { id: "OPENAI", name: "OpenAI", description: "GPT models via API" },
  { id: "ANTHROPIC", name: "Anthropic", description: "Claude models via API" },
  { id: "OLLAMA", name: "Ollama", description: "Local models — no data leaves your server" },
  { id: "LMSTUDIO", name: "LM Studio", description: "Local OpenAI-compatible server" },
  { id: "CUSTOM", name: "Custom endpoint", description: "Any OpenAI-compatible API (e.g. 9Router)" },
];

const providerLabel = (p: ProviderId) =>
  providers.find((x) => x.id === p)?.name ?? p;

const needsKey = (p: ProviderId) => p === "OPENAI" || p === "ANTHROPIC" || p === "CUSTOM";
const needsUrl = (p: ProviderId) => p === "OLLAMA" || p === "LMSTUDIO" || p === "CUSTOM";

interface Endpoint {
  id: string;
  name: string;
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
  hasApiKey: boolean;
  temperature: number;
  maxTokens: number;
  systemPrompt: string | null;
  isActive: boolean;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
  createdAt: string;
}

interface TestStep {
  label: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

interface TestReport {
  ok: boolean;
  latencyMs: number;
  model: string;
  steps: TestStep[];
  error?: string;
}

interface LogLine {
  t: string;
  text: string;
  kind: "info" | "ok" | "error";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const stamp = () =>
  new Date().toLocaleTimeString("en-GB", { hour12: false });

/* ------------------------------------------------------------------ */
/* Test log viewer                                                     */
/* ------------------------------------------------------------------ */

function TestLog({ report }: { report: TestReport }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Terminal size={13} className="text-zinc-500" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Connection log
        </span>
        <span className="ml-auto font-mono text-[11px] text-zinc-500">
          {report.latencyMs}ms total
        </span>
      </div>
      <div className="space-y-1 px-3 py-2.5 font-mono text-[12px] leading-relaxed">
        {report.steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            {s.ok ? (
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-400" />
            ) : (
              <XCircle size={13} className="mt-0.5 shrink-0 text-rose-400" />
            )}
            <span className="shrink-0 text-zinc-600">+{s.ms}ms</span>
            <span className={s.ok ? "text-zinc-300" : "text-rose-300"}>
              {s.label}
              {s.detail && (
                <span className="block text-zinc-500">{s.detail}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      {!report.ok && report.error && (
        <div className="border-t border-zinc-800 px-3 py-2.5">
          <p className="font-mono text-[12px] leading-relaxed text-rose-300">
            {report.error}
          </p>
        </div>
      )}
      {report.ok && (
        <div className="border-t border-zinc-800 px-3 py-2">
          <p className="font-mono text-[12px] text-emerald-400">
            Connection OK — the endpoint answered the test prompt.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Endpoint form (create / edit)                                       */
/* ------------------------------------------------------------------ */

interface FormState {
  name: string;
  provider: ProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  temperature: string;
  maxTokens: string;
}

const emptyForm = (provider: ProviderId = "CUSTOM"): FormState => ({
  name: "",
  provider,
  model: "",
  baseUrl: provider === "OLLAMA" ? "http://localhost:11434" : provider === "LMSTUDIO" ? "http://localhost:1234/v1" : "",
  apiKey: "",
  temperature: "0.7",
  maxTokens: "800",
});

function EndpointForm({
  initial,
  editing,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  editing: boolean;
  saving: boolean;
  error: string | null;
  onSubmit: (f: FormState) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(initial);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
      className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Name" value={f.name} onChange={set("name")} placeholder="e.g. 9Router" />
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-zinc-700">Provider</label>
          <select
            value={f.provider}
            onChange={(e) => setF((prev) => ({ ...prev, provider: e.target.value as ProviderId }))}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.description}
              </option>
            ))}
          </select>
        </div>
        <Input label="Model" value={f.model} onChange={set("model")} placeholder="e.g. gpt-4o-mini" />
        {needsUrl(f.provider) && (
          <Input
            label="Base URL"
            value={f.baseUrl}
            onChange={set("baseUrl")}
            placeholder={
              f.provider === "OLLAMA"
                ? "http://localhost:11434"
                : f.provider === "LMSTUDIO"
                  ? "http://localhost:1234/v1"
                  : "https://api.9router.ai/v1"
            }
          />
        )}
        <Input
          label={editing ? "API key (leave blank to keep the saved one)" : "API key"}
          type="password"
          value={f.apiKey}
          onChange={set("apiKey")}
          placeholder={needsKey(f.provider) ? "Paste your API key" : "Optional for local servers"}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Temperature" type="number" step="0.1" min="0" max="2" value={f.temperature} onChange={set("temperature")} />
          <Input label="Max tokens" type="number" step="1" min="1" max="32000" value={f.maxTokens} onChange={set("maxTokens")} />
        </div>
      </div>
      {needsKey(f.provider) && !editing && (
        <p className="mt-3 text-xs text-zinc-500">
          The key is encrypted before it is stored and is never shown again.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
      )}
      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : editing ? "Save changes" : "Add endpoint"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const tones = ["Professional", "Friendly", "Playful", "Bold", "Minimal"];
const genTypes = [
  { id: "post", label: "Full post" },
  { id: "caption", label: "Caption" },
  { id: "hashtags", label: "Hashtags" },
  { id: "ideas", label: "Ideas" },
] as const;
const languages = ["Indonesian", "English"];

export default function AIStudioPage() {
  /* endpoints */
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Endpoint | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, TestReport>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  /* generator */
  const [genType, setGenType] = useState<(typeof genTypes)[number]["id"]>("post");
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState("Professional");
  const [language, setLanguage] = useState("Indonesian");
  const [customLanguage, setCustomLanguage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genLog, setGenLog] = useState<LogLine[]>([]);
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const genStartRef = useRef(0);

  const activeEndpoint = endpoints.find((e) => e.isActive) ?? null;

  const loadEndpoints = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/endpoints");
      const json = await res.json();
      if (res.ok) setEndpoints(json.endpoints ?? []);
    } catch {
      /* keep previous state */
    } finally {
      setLoadingEndpoints(false);
    }
  }, []);

  useEffect(() => {
    loadEndpoints();
  }, [loadEndpoints]);

  /* ticking elapsed timer while generating */
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => {
      setElapsed((Date.now() - genStartRef.current) / 1000);
    }, 100);
    return () => clearInterval(t);
  }, [generating]);

  const appendLog = (text: string, kind: LogLine["kind"] = "info") =>
    setGenLog((prev) => [...prev, { t: stamp(), text, kind }]);

  /* ---------------- endpoint actions ---------------- */

  const submitForm = async (f: FormState) => {
    setFormError(null);
    if (!f.name.trim()) return setFormError("Name is required.");
    if (!f.model.trim()) return setFormError("Model is required.");
    if (needsUrl(f.provider) && !f.baseUrl.trim())
      return setFormError("Base URL is required for this provider.");
    if (needsKey(f.provider) && !editing && !f.apiKey.trim())
      return setFormError("API key is required for this provider.");

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        provider: f.provider,
        model: f.model.trim(),
        temperature: Number(f.temperature) || 0.7,
        maxTokens: Math.max(1, parseInt(f.maxTokens, 10) || 800),
      };
      if (f.baseUrl.trim()) body.baseUrl = f.baseUrl.trim();
      if (f.apiKey.trim()) body.apiKey = f.apiKey.trim();

      const url = editing ? `/api/ai/endpoints/${editing.id}` : "/api/ai/endpoints";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(
          json.error ??
            (json.details ? "Validation failed. Check the highlighted fields." : "Could not save the endpoint.")
        );
        return;
      }
      setFormOpen(false);
      setEditing(null);
      await loadEndpoints();
    } catch {
      setFormError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const testEndpoint = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpointId: id }),
      });
      const report = (await res.json()) as TestReport;
      setReports((prev) => ({ ...prev, [id]: report }));
      await loadEndpoints(); // refresh lastCheck badges
    } catch {
      setReports((prev) => ({
        ...prev,
        [id]: {
          ok: false,
          latencyMs: 0,
          model: "",
          steps: [],
          error: "Network error: could not reach the dashboard server.",
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const setActive = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/ai/endpoints/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      if (res.ok) await loadEndpoints();
    } finally {
      setBusyId(null);
    }
  };

  const deleteEndpoint = async (ep: Endpoint) => {
    if (
      !window.confirm(
        `Delete the endpoint "${ep.name}"? This cannot be undone.`
      )
    )
      return;
    setBusyId(ep.id);
    try {
      const res = await fetch(`/api/ai/endpoints/${ep.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        window.alert(json.error ?? "Could not delete the endpoint.");
        return;
      }
      setReports((prev) => {
        const next = { ...prev };
        delete next[ep.id];
        return next;
      });
      await loadEndpoints();
    } finally {
      setBusyId(null);
    }
  };

  const statusBadge = (ep: Endpoint) => {
    if (!ep.lastCheckAt) return <Badge tone="neutral">Never checked</Badge>;
    if (ep.lastCheckOk)
      return (
        <Badge tone="success" dot>
          Checked OK · {timeAgo(ep.lastCheckAt)}
        </Badge>
      );
    return <Badge tone="danger">Check failed</Badge>;
  };

  /* ---------------- generation ---------------- */

  const effectiveLanguage =
    language === "__custom" ? customLanguage.trim() : language;

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    if (!activeEndpoint) {
      setGenLog([
        {
          t: stamp(),
          text: "No active AI endpoint. Add an endpoint above and test the connection first.",
          kind: "error",
        },
      ]);
      setOutput("");
      return;
    }
    const lang = effectiveLanguage;
    if (language === "__custom" && !lang) {
      setGenLog([{ t: stamp(), text: "Enter a language or pick Indonesian / English.", kind: "error" }]);
      return;
    }

    setGenerating(true);
    setOutput("");
    setCopied(false);
    setGenLog([]);
    setElapsed(0);
    genStartRef.current = Date.now();
    appendLog(
      `Request sent to ${providerLabel(activeEndpoint.provider)} / ${activeEndpoint.model} (type=${genType}, tone=${tone}${lang ? `, language=${lang}` : ""})`
    );

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: genType,
          prompt: prompt.trim(),
          tone,
          ...(lang ? { language: lang } : {}),
        }),
      });
      const json = await res.json();
      const secs = ((Date.now() - genStartRef.current) / 1000).toFixed(1);
      if (!res.ok) {
        appendLog(
          `Failed after ${secs}s: ${json.error ?? "Generation failed."}${json.hint ? ` (${json.hint})` : ""}`,
          "error"
        );
        return;
      }
      let text = "";
      if (genType === "ideas" && Array.isArray(json.ideas)) {
        text = json.ideas
          .map((idea: unknown, i: number) => {
            if (typeof idea === "string") return `${i + 1}. ${idea}`;
            const o = idea as { title?: string; hook?: string; hashtags?: string[] };
            return (
              `${i + 1}. ${o.title ?? ""}` +
              (o.hook ? `\n   Hook: ${o.hook}` : "") +
              (o.hashtags?.length ? `\n   ${o.hashtags.join(" ")}` : "")
            );
          })
          .join("\n\n");
      } else {
        text = json.text ?? "";
      }
      if (!text.trim()) {
        appendLog(
          `Finished in ${secs}s but the provider returned an empty result. Try again or check the endpoint model.`,
          "error"
        );
        return;
      }
      appendLog(`Done in ${secs}s`, "ok");
      setOutput(text);
    } catch {
      const secs = ((Date.now() - genStartRef.current) / 1000).toFixed(1);
      appendLog(`Failed after ${secs}s: network error reaching the dashboard server.`, "error");
    } finally {
      setGenerating(false);
    }
  };

  const copyOutput = () => {
    navigator.clipboard?.writeText(output).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  /* ---------------- render ---------------- */

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">AI Studio</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Connect one or more AI endpoints, verify them, then generate content.
        </p>
      </div>

      {/* Endpoints */}
      <Card
        title="AI endpoints"
        subtitle="Each endpoint has its own base URL and API key. The active one powers generation and auto-replies."
        action={
          !formOpen && (
            <Button
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => {
                setEditing(null);
                setFormError(null);
                setFormOpen(true);
              }}
            >
              Add endpoint
            </Button>
          )
        }
      >
        {loadingEndpoints ? (
          <div className="h-32 animate-pulse rounded-lg bg-zinc-100" />
        ) : (
          <div className="space-y-4">
            {formOpen && (
              <EndpointForm
                initial={
                  editing
                    ? {
                        name: editing.name,
                        provider: editing.provider,
                        model: editing.model,
                        baseUrl: editing.baseUrl ?? "",
                        apiKey: "",
                        temperature: String(editing.temperature),
                        maxTokens: String(editing.maxTokens),
                      }
                    : emptyForm("CUSTOM")
                }
                editing={Boolean(editing)}
                saving={saving}
                error={formError}
                onSubmit={submitForm}
                onCancel={() => {
                  setFormOpen(false);
                  setEditing(null);
                  setFormError(null);
                }}
              />
            )}

            {endpoints.length === 0 && !formOpen ? (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 px-6 py-10 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white">
                  <Plug size={18} />
                </span>
                <p className="mt-3 text-sm font-semibold text-zinc-900">No AI endpoints yet</p>
                <p className="mx-auto mt-1 max-w-sm text-[13px] text-zinc-500">
                  Add your first endpoint — for example 9Router, OpenAI, or a local
                  Ollama server — then test the connection before generating.
                </p>
                <Button
                  className="mt-4"
                  icon={<Plus size={14} />}
                  onClick={() => setFormOpen(true)}
                >
                  Add your first endpoint
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {endpoints.map((ep) => (
                  <div
                    key={ep.id}
                    className={cn(
                      "rounded-xl border p-4",
                      ep.isActive ? "border-indigo-300 bg-indigo-50/40" : "border-zinc-200 bg-white"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-zinc-900">
                            {ep.name}
                          </span>
                          {ep.isActive && <Badge tone="indigo">Active</Badge>}
                          {statusBadge(ep)}
                        </div>
                        <p className="mt-1 truncate font-mono text-xs text-zinc-500">
                          {providerLabel(ep.provider)} · {ep.model}
                          {ep.baseUrl && ` · ${ep.baseUrl}`}
                          {!ep.hasApiKey && <span className="text-amber-600"> · no API key</span>}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={
                          testingId === ep.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <RefreshCw size={13} />
                          )
                        }
                        onClick={() => testEndpoint(ep.id)}
                        disabled={testingId === ep.id}
                      >
                        {testingId === ep.id ? "Testing…" : "Test connection"}
                      </Button>
                      {!ep.isActive && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Check size={13} />}
                          onClick={() => setActive(ep.id)}
                          disabled={busyId === ep.id}
                        >
                          Set active
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Pencil size={13} />}
                        onClick={() => {
                          setEditing(ep);
                          setFormError(null);
                          setFormOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 size={13} />}
                        onClick={() => deleteEndpoint(ep)}
                        disabled={busyId === ep.id}
                        className="text-rose-600 hover:text-rose-700"
                      >
                        Delete
                      </Button>
                    </div>

                    {reports[ep.id] && <TestLog report={reports[ep.id] as TestReport} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Generator */}
      <Card
        title="Content generator"
        subtitle={
          activeEndpoint
            ? `Generating with ${activeEndpoint.name} (${providerLabel(activeEndpoint.provider)} / ${activeEndpoint.model})`
            : "Add and test an AI endpoint above first"
        }
        action={<Wand2 size={16} className="text-zinc-400" />}
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {genTypes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setGenType(t.id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                    genType === t.id ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-zinc-700">
                What is it about?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="e.g. Launching our new scheduling feature next week…"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-zinc-700">Tone</label>
              <div className="flex flex-wrap gap-1.5">
                {tones.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTone(t)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                      tone === t ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-zinc-700">
                Output language
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {languages.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLanguage(l)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                      language === l ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    )}
                  >
                    {l}
                  </button>
                ))}
                <button
                  onClick={() => setLanguage("__custom")}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                    language === "__custom" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  )}
                >
                  Other…
                </button>
                {language === "__custom" && (
                  <input
                    value={customLanguage}
                    onChange={(e) => setCustomLanguage(e.target.value)}
                    placeholder="e.g. Japanese, Spanish…"
                    className="w-44 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                )}
              </div>
            </div>
            <Button
              icon={generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              onClick={generate}
              disabled={!prompt.trim() || generating}
            >
              {generating ? "Generating…" : "Generate"}
            </Button>
          </div>

          <div className="flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
              <Terminal size={13} className="text-zinc-500" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Live log
              </span>
              {generating && (
                <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-amber-300">
                  <Loader2 size={11} className="animate-spin" />
                  {elapsed.toFixed(1)}s
                </span>
              )}
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed">
              {genLog.length === 0 && !generating && (
                <p className="text-zinc-600">
                  Every step of the generation will be logged here in real time.
                </p>
              )}
              {genLog.map((line, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="shrink-0 text-zinc-600">[{line.t}]</span>
                  <span
                    className={
                      line.kind === "error"
                        ? "text-rose-300"
                        : line.kind === "ok"
                          ? "text-emerald-400"
                          : "text-zinc-300"
                    }
                  >
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto border-t border-zinc-800 bg-zinc-900/40 px-4 py-3">
              {output ? (
                <>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-100">{output}</p>
                  <button
                    onClick={copyOutput}
                    className="ml-auto mt-4 flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 ring-1 ring-zinc-700 hover:text-white"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </>
              ) : (
                !generating && (
                  <p className="text-center text-[13px] text-zinc-600">
                    {genLog.some((l) => l.kind === "error")
                      ? "See the log above for what went wrong."
                      : "Your generated content will appear here."}
                  </p>
                )
              )}
            </div>
          </div>
        </div>
      </Card>

    </div>
  );
}
