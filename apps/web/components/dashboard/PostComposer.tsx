"use client";

import { useMemo, useState } from "react";
import {
  Sparkles,
  ImagePlus,
  Images,
  CalendarDays,
  Check,
  Loader2,
  X,
  Film,
  UploadCloud,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n/LanguageProvider";
import Button from "../ui/Button";
import PlatformIcon from "./PlatformIcon";
import MediaPicker from "./MediaPicker";
import {
  PLATFORM_META,
  PLATFORM_CATEGORIES,
  defaultCategoryFor,
  categoryFor,
  type PlatformSlug,
} from "../../lib/platforms";

export interface ComposerPayload {
  content: string;
  platforms: PlatformSlug[];
  scheduledAt: string;
  mediaUrls: string[];
  /** Enum platform name -> category id, e.g. { YOUTUBE: "shorts" }. */
  platformCategories: Record<string, string>;
  thumbnailUrl: string | null;
}

interface PostComposerProps {
  onClose: () => void;
  onSubmit: (payload: ComposerPayload) => void;
  /** Only connected platforms can be targeted. */
  availablePlatforms: PlatformSlug[];
}

const MAX_CHARS = 2200;

function defaultScheduledAt() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const isVideoUrl = (u: string) => /\.(mp4|mov|webm|mkv|avi)(\?|#|$)/i.test(u);

export default function PostComposer({ onClose, onSubmit, availablePlatforms }: PostComposerProps) {
  const t = useT();
  const [content, setContent] = useState("");
  const [platforms, setPlatforms] = useState<PlatformSlug[]>(availablePlatforms.slice(0, 2));
  const [categories, setCategories] = useState<Record<PlatformSlug, string>>(() => {
    const init = {} as Record<PlatformSlug, string>;
    for (const p of availablePlatforms) init[p] = defaultCategoryFor(p);
    return init;
  });
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt());
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [media, setMedia] = useState<string[]>([]);
  const [mediaInput, setMediaInput] = useState("");
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [thumbPickerOpen, setThumbPickerOpen] = useState(false);

  const togglePlatform = (p: PlatformSlug) => {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  const handleEnhance = async () => {
    if (!content.trim() || enhancing) return;
    setEnhancing(true);
    setEnhanceError(null);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "post", prompt: content.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEnhanceError(json.error ?? "AI enhance failed. Configure a provider in AI Studio.");
        return;
      }
      if (json.text) setContent(String(json.text).slice(0, MAX_CHARS));
    } catch {
      setEnhanceError("Network error. Try again.");
    } finally {
      setEnhancing(false);
    }
  };

  const addMediaUrl = () => {
    const url = mediaInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setEnhanceError(t("composer.mediaUrlPlaceholder"));
      return;
    }
    if (!media.includes(url)) setMedia((m) => [...m, url]);
    setMediaInput("");
    setEnhanceError(null);
  };

  const hasVideo = useMemo(() => media.some(isVideoUrl), [media]);

  const categoryWarnings = useMemo(() => {
    const warns: string[] = [];
    for (const p of platforms) {
      const cat = categoryFor(p, categories[p] ?? defaultCategoryFor(p));
      if (!cat) continue;
      if (cat.needsVideo && !hasVideo) {
        warns.push(`${PLATFORM_META[p].label}: ${t("composer.needsVideo", { label: cat.label })}`);
      }
      if (cat.needsImage && media.length === 0) {
        warns.push(`${PLATFORM_META[p].label}: ${t("composer.needsImage", { label: cat.label })}`);
      }
    }
    return warns;
  }, [platforms, categories, hasVideo, media.length, t]);

  const canSubmit = content.trim().length > 0 && platforms.length > 0;

  const submitPayload = (when: string): ComposerPayload => ({
    content: content.trim(),
    platforms,
    scheduledAt: when,
    mediaUrls: media,
    platformCategories: Object.fromEntries(
      platforms.map((p) => [p.toUpperCase(), categories[p] ?? defaultCategoryFor(p)])
    ),
    thumbnailUrl: thumbnail,
  });

  return (
    <div className="space-y-5">
      {/* Platforms */}
      <div>
        <p className="mb-2 text-[13px] font-medium text-zinc-700">Publish to</p>
        {availablePlatforms.length === 0 ? (
          <p className="text-[13px] text-zinc-500">
            No connected accounts. Connect a platform first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {availablePlatforms.map((p) => {
              const active = platforms.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-all",
                    active
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500/30"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
                  )}
                >
                  <PlatformIcon platform={p} size="xs" />
                  <span>{PLATFORM_META[p].label}</span>
                  {active && <Check size={14} className="text-indigo-600" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Per-platform category */}
      {platforms.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">Post type per platform</p>
          <div className="space-y-2">
            {platforms.map((p) => (
              <div key={p} className="flex items-center gap-3">
                <span className="flex w-32 shrink-0 items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-300">
                  <PlatformIcon platform={p} size="xs" />
                  {PLATFORM_META[p].label}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORM_CATEGORIES[p].map((c) => {
                    const active = (categories[p] ?? defaultCategoryFor(p)) === c.id;
                    return (
                      <button
                        key={c.id}
                        title={c.blurb}
                        onClick={() => setCategories((prev) => ({ ...prev, [p]: c.id }))}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                          active
                            ? "border-indigo-500 bg-indigo-600 text-white"
                            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600"
                        )}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {categoryWarnings.map((w) => (
            <p key={w} className="mt-2 text-xs text-amber-600 dark:text-amber-400">{w}</p>
          ))}
        </div>
      )}

      {/* Content */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-medium text-zinc-700">Content</p>
          <Button
            variant="ghost"
            size="xs"
            icon={enhancing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            onClick={handleEnhance}
            disabled={!content.trim() || enhancing}
            title="Rewrite with your configured AI provider"
          >
            {enhancing ? "Enhancing…" : "AI enhance"}
          </Button>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, MAX_CHARS))}
          rows={5}
          placeholder="Write your post…"
          className="w-full resize-none rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        {enhanceError && <p className="mt-1.5 text-xs text-rose-600">{enhanceError}</p>}
        <div className="mt-1 flex justify-end">
          <span className={cn("tnum text-[11px]", content.length > MAX_CHARS * 0.9 ? "text-amber-600" : "text-zinc-400")}>
            {content.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Media */}
      <div>
        <p className="mb-2 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{t("composer.media")}</p>
        {media.length > 0 && (
          <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {media.map((m) => {
              const video = isVideoUrl(m);
              return (
                <div key={m} className="group relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                  <div className="aspect-video w-full">
                    {video ? (
                      <video src={m} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-white">
                    {video ? <Film size={11} /> : <ImagePlus size={11} />}
                    <span className="truncate text-[11px]">{m.split("/").pop()}</span>
                  </div>
                  <button
                    onClick={() => setMedia(media.filter((x) => x !== m))}
                    className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity hover:bg-rose-600 group-hover:opacity-100"
                    aria-label={t("composer.remove")}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Images size={14} />} onClick={() => setPickerOpen(true)}>
            {t("composer.fromLibrary")}
          </Button>
          <div className="flex min-w-0 flex-1 gap-2">
            <input
              value={mediaInput}
              onChange={(e) => setMediaInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMediaUrl()}
              placeholder={t("composer.mediaUrlPlaceholder")}
              className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <Button variant="secondary" size="sm" onClick={addMediaUrl} icon={<ImagePlus size={14} />}>
              {t("composer.addUrl")}
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">{t("media.subtitle")}</p>
      </div>

      {/* Thumbnail */}
      <div>
        <p className="mb-2 text-[13px] font-medium text-zinc-700">{t("composer.thumbnail")} <span className="font-normal text-zinc-400">({t("composer.thumbnailHint")})</span></p>
        <div className="flex items-center gap-3">
          {thumbnail ? (
            <div className="group relative w-40 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbnail} alt="Thumbnail" className="aspect-video w-full object-cover" />
              <button
                onClick={() => setThumbnail(null)}
                className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-1 text-white hover:bg-rose-600"
                aria-label={t("composer.remove")}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setThumbPickerOpen(true)}
              className="flex w-40 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50 py-5 text-zinc-400 transition-colors hover:border-indigo-300 hover:text-indigo-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-500 dark:hover:border-indigo-500"
            >
              <UploadCloud size={18} />
              <span className="text-[11px] font-medium">{t("composer.pickThumbnail")}</span>
            </button>
          )}
          <div className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            <p>{t("composer.aspect")}: 1280×720 (16:9).</p>
          </div>
        </div>
      </div>

      {/* Schedule */}
      <div>
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-zinc-700">
            <CalendarDays size={14} className="text-zinc-400" />
            Date &amp; time
          </span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 border-t border-zinc-100 pt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" disabled={!canSubmit} onClick={() => canSubmit && onSubmit(submitPayload(new Date().toISOString()))}>
          Publish now
        </Button>
        <Button disabled={!canSubmit} onClick={() => canSubmit && onSubmit(submitPayload(scheduledAt))}>
          Schedule post
        </Button>
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(urls) => setMedia((m) => [...m, ...urls.filter((u) => !m.includes(u))])}
        title="Pick media for this post"
      />
      <MediaPicker
        open={thumbPickerOpen}
        onClose={() => setThumbPickerOpen(false)}
        onPick={(urls) => urls[0] && setThumbnail(urls[0])}
        kind="image"
        multi={false}
        title="Pick a thumbnail"
      />
    </div>
  );
}
