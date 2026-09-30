"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Trash2, Clock3, CalendarClock } from "lucide-react";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Modal from "../../../components/ui/Modal";
import PlatformIcon from "../../../components/dashboard/PlatformIcon";
import PostComposer, { type ComposerPayload } from "../../../components/dashboard/PostComposer";
import {
  PLATFORM_META,
  PLATFORM_SLUGS,
  enumFromSlug,
  slugFromEnum,
  type PlatformSlug,
} from "../../../lib/platforms";
import { cn } from "../../../lib/utils";

type PostStatus = "DRAFT" | "QUEUED" | "PUBLISHING" | "PUBLISHED" | "FAILED";

interface ApiPost {
  id: string;
  content: string;
  mediaUrls: unknown;
  platforms: string[];
  scheduledAt: string | null;
  publishedAt: string | null;
  status: PostStatus;
  errorMessage?: string | null;
  createdAt: string;
}

type Filter = "all" | "DRAFT" | "QUEUED" | "PUBLISHED" | "FAILED";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "DRAFT", label: "Drafts" },
  { id: "QUEUED", label: "Queued" },
  { id: "PUBLISHED", label: "Published" },
  { id: "FAILED", label: "Failed" },
];

const statusTone: Record<PostStatus, "warning" | "indigo" | "info" | "success" | "danger"> = {
  DRAFT: "indigo",
  QUEUED: "warning",
  PUBLISHING: "info",
  PUBLISHED: "success",
  FAILED: "danger",
};

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SchedulerPage() {
  const [posts, setPosts] = useState<ApiPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [connectedPlatforms, setConnectedPlatforms] = useState<PlatformSlug[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [postsRes, accountsRes] = await Promise.all([
        fetch("/api/posts?pageSize=50"),
        fetch("/api/accounts"),
      ]);
      const postsJson = await postsRes.json();
      const accountsJson = await accountsRes.json();
      setPosts(Array.isArray(postsJson.posts) ? postsJson.posts : []);
      const rawAccounts: { isActive: boolean; platform: string }[] = Array.isArray(accountsJson.accounts)
        ? accountsJson.accounts
        : [];
      const slugs: PlatformSlug[] = rawAccounts
        .filter((a) => a.isActive)
        .map((a) => slugFromEnum(a.platform))
        .filter((s): s is PlatformSlug => s !== null);
      setConnectedPlatforms([...new Set(slugs)]);
    } catch {
      setToast("Could not load posts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => posts.filter((p) => filter === "all" || p.status === filter),
    [posts, filter]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: posts.length, DRAFT: 0, QUEUED: 0, PUBLISHED: 0, FAILED: 0 };
    for (const p of posts) {
      if (p.status === "PUBLISHING") c.QUEUED = (c.QUEUED ?? 0) + 1;
      else c[p.status] = (c[p.status] ?? 0) + 1;
    }
    return c;
  }, [posts]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const addPost = async (payload: ComposerPayload) => {
    const platforms = payload.platforms
      .map((s) => ((PLATFORM_SLUGS as string[]).includes(s) ? enumFromSlug(s as PlatformSlug) : null))
      .filter((p): p is string => p !== null);
    if (platforms.length === 0) {
      showToast("Select at least one platform.");
      return;
    }
    // datetime-local gives "YYYY-MM-DDTHH:mm" (no offset); the API requires
    // an ISO datetime with offset.
    const scheduledAtIso = payload.scheduledAt
      ? new Date(payload.scheduledAt).toISOString()
      : null;
    try {
      const createRes = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: payload.content,
          platforms,
          scheduledAt: scheduledAtIso,
          mediaUrls: payload.mediaUrls,
          platformCategories: payload.platformCategories,
          thumbnailUrl: payload.thumbnailUrl,
        }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok) {
        showToast(createJson.error ?? "Could not create post.");
        return;
      }
      const scheduleRes = await fetch("/api/posts/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: createJson.post.id,
          scheduledAt: scheduledAtIso || undefined,
        }),
      });
      const scheduleJson = await scheduleRes.json();
      if (!scheduleRes.ok) {
        showToast(scheduleJson.error ?? "Post created as draft, but scheduling failed.");
      } else {
        showToast("Post scheduled and added to the queue.");
      }
      setComposerOpen(false);
      load();
    } catch {
      showToast("Network error. Try again.");
    }
  };

  const retryPost = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch("/api/posts/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: id }),
      });
      const json = await res.json();
      showToast(res.ok ? "Post re-queued for publishing." : (json.error ?? "Retry failed."));
      load();
    } catch {
      showToast("Network error. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const deletePost = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
      const json = await res.json();
      showToast(res.ok ? "Post deleted." : (json.error ?? "Delete failed."));
      if (res.ok) setPosts((prev) => prev.filter((p) => p.id !== id));
    } catch {
      showToast("Network error. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Content scheduler
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Queue, schedule and publish across every connected platform.
          </p>
        </div>
        <Button
          icon={<Plus size={15} />}
          onClick={() => setComposerOpen(true)}
          disabled={connectedPlatforms.length === 0}
          title={connectedPlatforms.length === 0 ? "Connect an account first" : undefined}
        >
          New post
        </Button>
      </div>

      {/* Queue overview strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Drafts", value: counts.DRAFT, tone: "text-indigo-600 bg-indigo-50" },
          { label: "In queue", value: counts.QUEUED, tone: "text-amber-600 bg-amber-50" },
          { label: "Published", value: counts.PUBLISHED, tone: "text-emerald-600 bg-emerald-50" },
          { label: "Failed", value: counts.FAILED, tone: "text-rose-600 bg-rose-50" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 shadow-card">
            <span className={cn("tnum rounded-lg px-2.5 py-1 text-lg font-semibold", s.tone)}>
              {s.value}
            </span>
            <span className="text-[13px] font-medium text-zinc-500">{s.label}</span>
          </div>
        ))}
      </div>

      <Card padded={false}>
        <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-100 px-4 pt-3">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "relative whitespace-nowrap rounded-t-lg px-3.5 py-2.5 text-[13px] font-medium transition-colors",
                filter === f.id ? "text-indigo-700" : "text-zinc-500 hover:text-zinc-800"
              )}
            >
              {f.label}
              <span className={cn("tnum ml-1.5 rounded-full px-1.5 py-0.5 text-[11px]", filter === f.id ? "bg-indigo-100 text-indigo-700" : "bg-zinc-100 text-zinc-500")}>
                {counts[f.id] ?? 0}
              </span>
              {filter === f.id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-indigo-600" />
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3 px-5 py-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-100" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
              <CalendarClock size={22} />
            </span>
            <p className="mt-3 text-sm font-semibold text-zinc-900">No posts here yet</p>
            <p className="mt-1 max-w-sm text-[13px] text-zinc-500">
              {connectedPlatforms.length === 0
                ? "Connect a social account first, then compose your first post."
                : "Compose a post and it will appear in the queue."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {visible.map((post) => (
              <li key={post.id} className="animate-fade-up px-5 py-4 hover:bg-zinc-50/60">
                <div className="flex items-start gap-4">
                  <div className="flex shrink-0 -space-x-1.5 pt-0.5">
                    {post.platforms.map((p) => {
                      const slug = slugFromEnum(p);
                      return (
                        <span key={p} className="rounded-full ring-2 ring-white" title={slug ? PLATFORM_META[slug].label : p}>
                          {slug && <PlatformIcon platform={slug} size="sm" />}
                        </span>
                      );
                    })}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13.5px] font-medium leading-relaxed text-zinc-900">
                      {post.content}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                      <span className="flex items-center gap-1">
                        <Clock3 size={12} />
                        {post.status === "PUBLISHED"
                          ? `Published ${formatDateTime(post.publishedAt)}`
                          : `Scheduled ${formatDateTime(post.scheduledAt)}`}
                      </span>
                      {post.errorMessage && (
                        <span className="text-rose-500">{post.errorMessage.slice(0, 120)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={statusTone[post.status]} dot={post.status === "PUBLISHING"}>
                      <span className="capitalize">{post.status.toLowerCase()}</span>
                    </Badge>
                    {post.status === "FAILED" && (
                      <Button
                        variant="secondary"
                        size="xs"
                        icon={<RotateCcw size={12} />}
                        onClick={() => retryPost(post.id)}
                        disabled={busyId === post.id}
                      >
                        Retry
                      </Button>
                    )}
                    {["DRAFT", "QUEUED", "FAILED"].includes(post.status) && (
                      <button
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Delete"
                        onClick={() => deletePost(post.id)}
                        disabled={busyId === post.id}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Compose post"
        subtitle="Write once — publishing runs through the background worker."
        wide
      >
        <PostComposer
          onClose={() => setComposerOpen(false)}
          onSubmit={addPost}
          availablePlatforms={connectedPlatforms}
        />
      </Modal>

      {toast && (
        <div className="animate-fade-up fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-pop">
          {toast}
        </div>
      )}
    </div>
  );
}
