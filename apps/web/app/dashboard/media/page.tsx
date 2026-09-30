"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Film,
  Image as ImageIcon,
  Images,
  Loader2,
  Trash2,
  UploadCloud,
  Link2,
  Check,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { useT } from "../../../lib/i18n/LanguageProvider";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";

interface MediaAssetDto {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function MediaLibraryPage() {
  const [assets, setAssets] = useState<MediaAssetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/media?pageSize=100");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t("media.loadError"));
      setAssets(json.assets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("media.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of list) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/media", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `${t("media.uploadError")} ${file.name}`);
      }
      await load();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t("media.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const deleteAsset = async (id: string) => {
    if (!window.confirm(t("media.deleteConfirm"))) return;
    try {
      const res = await fetch(`/api/media/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
      setAssets((a) => a.filter((x) => x.id !== id));
    } catch {
      setUploadError(t("media.deleteError"));
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const visible = assets.filter((a) =>
    filter === "all"
      ? true
      : filter === "image"
        ? a.mimeType.startsWith("image/")
        : a.mimeType.startsWith("video/")
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">
            <Images size={20} className="text-indigo-600" />
            {t("media.title")}
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
            {t("media.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-[13px] dark:border-zinc-700 dark:bg-zinc-800">
            {(["all", "image", "video"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium capitalize transition-colors",
                  filter === f ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                )}
              >
                {f === "all" ? t("common.all") : f === "image" ? t("media.images") : t("media.videos")}
              </button>
            ))}
          </div>
          <Button icon={uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />} onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? t("media.uploading") : t("media.upload")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          uploadFiles(e.dataTransfer.files);
        }}
        className="flex items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-8 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-400"
      >
        <UploadCloud size={20} className="text-zinc-400 dark:text-zinc-500" />
        <p className="text-[13px]">{t("media.dragDrop")} — {t("media.formats")}</p>
      </div>
      {uploadError && <p className="text-xs text-rose-600 dark:text-rose-400">{uploadError}</p>}

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : error ? (
          <p className="py-12 text-center text-sm text-rose-600 dark:text-rose-400">{error}</p>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center">
            <Images size={28} className="mx-auto text-zinc-300 dark:text-zinc-600" />
            <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">{t("media.empty")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((a) => {
              const isVideo = a.mimeType.startsWith("video/");
              return (
                <div key={a.id} className="group overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
                  <div className="relative aspect-video w-full bg-zinc-100 dark:bg-zinc-700">
                    {isVideo ? (
                      <video src={a.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt={a.originalName} className="h-full w-full object-cover" loading="lazy" />
                    )}
                    <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => copyUrl(a.url)}
                        className="rounded-full bg-black/50 p-1.5 text-white hover:bg-indigo-600"
                        title={t("media.copyUrl")}
                        aria-label={t("media.copyUrl")}
                      >
                        {copied === a.url ? <Check size={12} /> : <Link2 size={12} />}
                      </button>
                      <button
                        onClick={() => deleteAsset(a.id)}
                        className="rounded-full bg-black/50 p-1.5 text-white hover:bg-rose-600"
                        title={t("common.delete")}
                        aria-label={t("common.delete")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-2">
                    {isVideo ? <Film size={12} className="shrink-0 text-zinc-400" /> : <ImageIcon size={12} className="shrink-0 text-zinc-400" />}
                    <span className="truncate text-xs text-zinc-600 dark:text-zinc-300" title={a.originalName}>
                      {a.originalName}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">{formatBytes(a.size)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
