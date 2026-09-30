"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Radio,
  Square,
  Play,
  Trash2,
  Plus,
  Repeat,
  ImagePlus,
  X,
} from "lucide-react";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Modal from "../../../components/ui/Modal";
import Input from "../../../components/ui/Input";
import PlatformIcon from "../../../components/dashboard/PlatformIcon";
import MediaPicker from "../../../components/dashboard/MediaPicker";
import { useT } from "../../../lib/i18n/LanguageProvider";
import { PLATFORM_META, PLATFORM_SLUGS, slugFromEnum, type PlatformSlug } from "../../../lib/platforms";
import { cn } from "../../../lib/utils";

interface ApiStream {
  id: string;
  title: string;
  description?: string | null;
  videoUrl: string;
  rtmpUrl: string;
  platform: string;
  status: "IDLE" | "LIVE" | "ENDED" | "ERROR";
  loop: boolean;
  thumbnailUrl?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  errorMessage?: string | null;
  hasRtmpKey: boolean;
  engine?: { viewers?: number; uptimeSec?: number } | null;
}

const statusTone: Record<ApiStream["status"], "success" | "neutral" | "danger"> = {
  LIVE: "success",
  IDLE: "neutral",
  ENDED: "neutral",
  ERROR: "danger",
};

export default function LivePage() {
  const t = useT();
  const [streams, setStreams] = useState<ApiStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // New stream form
  const [fTitle, setFTitle] = useState("");
  const [fVideoUrl, setFVideoUrl] = useState("");
  const [fRtmpUrl, setFRtmpUrl] = useState("");
  const [fRtmpKey, setFRtmpKey] = useState("");
  const [fPlatform, setFPlatform] = useState<PlatformSlug>("youtube");
  const [fLoop, setFLoop] = useState(true);
  const [fThumbnail, setFThumbnail] = useState<string | null>(null);
  const [thumbPickerOpen, setThumbPickerOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/live");
      const json = await res.json();
      setStreams(Array.isArray(json.streams) ? json.streams : []);
    } catch {
      showToast("Could not load streams.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createStream = async () => {
    setFormError(null);
    if (!fTitle.trim() || !fVideoUrl.trim() || !fRtmpUrl.trim() || !fRtmpKey.trim()) {
      setFormError("Title, source video, RTMP URL and stream key are required.");
      return;
    }
    setBusyId("new");
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: fTitle.trim(),
          videoUrl: fVideoUrl.trim(),
          rtmpUrl: fRtmpUrl.trim(),
          rtmpKey: fRtmpKey.trim(),
          platform: fPlatform.toUpperCase(),
          loop: fLoop,
          thumbnailUrl: fThumbnail,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? "Could not create the stream.");
        return;
      }
      setStreams((prev) => [json.stream, ...prev]);
      setModalOpen(false);
      setFTitle("");
      setFVideoUrl("");
      setFRtmpUrl("");
      setFRtmpKey("");
      setFThumbnail(null);
      showToast("Stream configuration created.");
    } catch {
      setFormError("Network error. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const startStream = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/live/${id}/start`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Could not start the stream.");
        return;
      }
      showToast("Stream started.");
      load();
    } catch {
      showToast("Network error. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const stopStream = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/live/${id}/stop`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Could not stop the stream.");
        return;
      }
      showToast("Stream stopped.");
      load();
    } catch {
      showToast("Network error. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteStream = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/live/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setStreams((prev) => prev.filter((s) => s.id !== id));
      showToast("Stream deleted.");
    } catch {
      showToast("Could not delete the stream.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Live streaming</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Loop a source video to RTMP destinations. The streaming engine runs on
            this server via FFmpeg.
          </p>
        </div>
        <Button icon={<Plus size={15} />} onClick={() => setModalOpen(true)}>
          New stream
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl bg-zinc-200/70" />
          ))}
        </div>
      ) : streams.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
            <Radio size={26} />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-zinc-900">No streams configured</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
            Create a stream with a source video and an RTMP destination (YouTube,
            Facebook, Twitch, or your own server), then go live.
          </p>
          <Button icon={<Plus size={15} />} className="mt-6" onClick={() => setModalOpen(true)}>
            Create your first stream
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {streams.map((s) => {
            const slug = slugFromEnum(s.platform);
            const live = s.status === "LIVE";
            return (
              <Card key={s.id} className="animate-fade-up">
                {s.thumbnailUrl && (
                  <div className="-mx-5 -mt-5 mb-4 overflow-hidden rounded-t-xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.thumbnailUrl} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                  </div>
                )}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                        live ? "bg-rose-100 text-rose-600" : "bg-zinc-100 text-zinc-500"
                      )}
                    >
                      <Radio size={20} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-zinc-900">{s.title}</p>
                      <p className="flex items-center gap-1.5 text-[13px] text-zinc-500">
                        {slug && <PlatformIcon platform={slug} size="xs" />}
                        {slug ? PLATFORM_META[slug].label : s.platform}
                        {s.loop && (
                          <span className="flex items-center gap-1 text-zinc-400">
                            <Repeat size={11} /> loop
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <Badge tone={statusTone[s.status]} dot={live}>
                    {live ? "Live" : s.status.charAt(0) + s.status.slice(1).toLowerCase()}
                  </Badge>
                </div>

                {s.errorMessage && (
                  <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
                    {s.errorMessage}
                  </p>
                )}

                <div className="mt-4 flex items-center gap-2 border-t border-zinc-100 pt-4">
                  {live ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      icon={<Square size={13} />}
                      onClick={() => stopStream(s.id)}
                      disabled={busyId === s.id}
                    >
                      {busyId === s.id ? "Stopping…" : "Stop stream"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="flex-1"
                      icon={<Play size={13} />}
                      onClick={() => startStream(s.id)}
                      disabled={busyId === s.id}
                    >
                      {busyId === s.id ? "Starting…" : "Go live"}
                    </Button>
                  )}
                  <button
                    onClick={() => deleteStream(s.id)}
                    disabled={busyId === s.id}
                    className="rounded-lg p-2 text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Delete stream"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* New stream modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New live stream"
        subtitle="Looped video source pushed to an RTMP destination."
      >
        <div className="space-y-4">
          <Input
            label="Title"
            value={fTitle}
            onChange={(e) => setFTitle(e.target.value)}
            placeholder="e.g. 24/7 product demo loop"
          />
          <Input
            label="Source video URL"
            value={fVideoUrl}
            onChange={(e) => setFVideoUrl(e.target.value)}
            placeholder="https://…/video.mp4 or a local path on the server"
          />
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
              {t("live.thumbnail")} <span className="font-normal text-zinc-400">({t("live.thumbnailHint")})</span>
            </span>
            <div className="flex items-center gap-3">
              {fThumbnail ? (
                <div className="relative w-36 overflow-hidden rounded-lg border border-zinc-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fThumbnail} alt="Stream thumbnail" className="aspect-video w-full object-cover" />
                  <button
                    onClick={() => setFThumbnail(null)}
                    className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white hover:bg-rose-600"
                    aria-label="Remove thumbnail"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setThumbPickerOpen(true)}
                  className="flex w-36 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50 py-4 text-zinc-400 transition-colors hover:border-indigo-300 hover:text-indigo-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-500 dark:hover:border-indigo-500"
                >
                  <ImagePlus size={16} />
                  <span className="text-[11px] font-medium">{t("live.pickThumbnail")}</span>
                </button>
              )}
              <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {t("live.aspectHint")}<br />{t("live.pickFromLibrary")}
              </p>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-zinc-700">Destination platform</label>
            <div className="grid grid-cols-3 gap-2">
              {PLATFORM_SLUGS.map((p) => (
                <button
                  key={p}
                  onClick={() => setFPlatform(p)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors",
                    fPlatform === p
                      ? "border-indigo-500 bg-indigo-50/60 text-indigo-700"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                  )}
                >
                  <PlatformIcon platform={p} size="xs" />
                  {PLATFORM_META[p].label}
                </button>
              ))}
            </div>
          </div>
          <Input
            label="RTMP URL"
            value={fRtmpUrl}
            onChange={(e) => setFRtmpUrl(e.target.value)}
            placeholder="rtmp://a.rtmp.youtube.com/live2"
          />
          <Input
            label="Stream key"
            type="password"
            value={fRtmpKey}
            onChange={(e) => setFRtmpKey(e.target.value)}
            placeholder="Paste the stream key from the platform"
          />
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={fLoop}
              onChange={(e) => setFLoop(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 accent-indigo-600"
            />
            Loop the video indefinitely
          </label>
          {formError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{formError}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createStream} disabled={busyId === "new"}>
              {busyId === "new" ? "Creating…" : "Create stream"}
            </Button>
          </div>
        </div>
      </Modal>

      <MediaPicker
        open={thumbPickerOpen}
        onClose={() => setThumbPickerOpen(false)}
        onPick={(urls) => urls[0] && setFThumbnail(urls[0])}
        kind="image"
        multi={false}
        title={t("live.pickThumbnail")}
      />

      {toast && (
        <div className="animate-fade-up fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-pop">
          {toast}
        </div>
      )}
    </div>
  );
}
