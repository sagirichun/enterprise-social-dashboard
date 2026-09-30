"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Film,
  Image as ImageIcon,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n/LanguageProvider";
import Button from "../ui/Button";
import Modal from "../ui/Modal";

export interface MediaAssetDto {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the picked asset URLs (local /uploads/* or remote). */
  onPick: (urls: string[]) => void;
  /** "image" | "video" | undefined — filter shown assets. */
  kind?: "image" | "video";
  /** Allow picking several assets (default true). */
  multi?: boolean;
  title?: string;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function MediaPicker({
  open,
  onClose,
  onPick,
  kind,
  multi = true,
  title,
}: MediaPickerProps) {
  const [assets, setAssets] = useState<MediaAssetDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = kind ? `?kind=${kind}` : "";
      const res = await fetch(`/api/media${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t("media.loadError"));
      setAssets(json.assets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("media.loadError"));
    } finally {
      setLoading(false);
    }
  }, [kind, t]);

  useEffect(() => {
    if (open) {
      setSelected([]);
      setUploadError(null);
      load();
    }
  }, [open, load]);

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
      setSelected((s) => s.filter((x) => x !== id));
    } catch {
      setUploadError(t("media.deleteError"));
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) =>
      multi
        ? prev.includes(id)
          ? prev.filter((x) => x !== id)
          : [...prev, id]
        : [id]
    );
  };

  const confirmPick = () => {
    const urls = selected
      .map((id) => assets.find((a) => a.id === id)?.url)
      .filter((u): u is string => Boolean(u));
    onPick(urls);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={title ?? t("media.pickTitle")} wide>
      <div className="space-y-4">
        {/* Upload bar */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            uploadFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 transition-colors",
            uploading
              ? "border-indigo-300 bg-indigo-50/50 dark:border-indigo-500 dark:bg-indigo-500/10"
              : "border-zinc-200 bg-zinc-50 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-zinc-700 dark:bg-zinc-800/60 dark:hover:border-indigo-500"
          )}
        >
          {uploading ? (
            <Loader2 size={20} className="animate-spin text-indigo-600" />
          ) : (
            <UploadCloud size={20} className="text-zinc-400 dark:text-zinc-500" />
          )}
          <p className="text-[13px] text-zinc-600 dark:text-zinc-300">
            {uploading ? t("media.uploading") : t("media.formats")}
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple={multi}
            accept={kind === "image" ? "image/*" : kind === "video" ? "video/*" : "image/*,video/*"}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {uploadError && <p className="text-xs text-rose-600 dark:text-rose-400">{uploadError}</p>}

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-zinc-400 dark:text-zinc-500">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-rose-600 dark:text-rose-400">{error}</p>
        ) : assets.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t("media.empty")}
          </p>
        ) : (
          <div className="grid max-h-[46vh] grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4">
            {assets.map((a) => {
              const isVideo = a.mimeType.startsWith("video/");
              const active = selected.includes(a.id);
              return (
                <div
                  key={a.id}
                  onClick={() => toggle(a.id)}
                  className={cn(
                    "group relative cursor-pointer overflow-hidden rounded-lg border bg-zinc-100 transition-all dark:bg-zinc-800",
                    active
                      ? "border-indigo-500 ring-2 ring-indigo-500/40"
                      : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
                  )}
                >
                  <div className="aspect-video w-full">
                    {isVideo ? (
                      <video src={a.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt={a.originalName} className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-white">
                    {isVideo ? <Film size={12} /> : <ImageIcon size={12} />}
                    <span className="truncate text-[11px]">{a.originalName}</span>
                  </div>
                  {active && (
                    <div className="absolute right-1.5 top-1.5 rounded-full bg-indigo-600 p-1 text-white">
                      <Check size={12} />
                    </div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAsset(a.id);
                    }}
                    className="absolute left-1.5 top-1.5 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-rose-600 group-hover:opacity-100"
                    aria-label={t("media.deleteConfirm")}
                    title={`Delete (${formatBytes(a.size)})`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {selected.length > 0
              ? t("media.selectedCount", { count: selected.length })
              : t("media.subtitle")}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button disabled={selected.length === 0} onClick={confirmPick}>
              {t("media.useSelected")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
