export type PlatformId =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "x"
  | "threads"
  | "linkedin";

export interface Account {
  id: string;
  platform: PlatformId;
  name: string;
  handle: string;
  followers: number;
  engagement: number;
  posts30d: number;
  status: "connected" | "expired" | "error";
  connectedAt: string;
}

export interface ScheduledPost {
  id: string;
  content: string;
  platforms: PlatformId[];
  status: "queued" | "scheduled" | "publishing" | "published" | "failed";
  scheduledAt: string;
  media?: string;
  engagement?: { likes: number; comments: number; shares: number };
}

export interface InboxMessage {
  id: string;
  platform: PlatformId;
  author: string;
  authorHandle: string;
  text: string;
  sentiment: "positive" | "neutral" | "negative";
  sentimentScore: number;
  receivedAt: string;
  suggestedReply: string;
  status: "pending" | "replied" | "escalated";
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  trigger: string;
  enabled: boolean;
  repliesSent: number;
  lastTriggered: string;
}

export interface StreamSession {
  id: string;
  title: string;
  source: string;
  destinations: PlatformId[];
  status: "live" | "scheduled" | "offline";
  viewers: number;
  uptime: string;
  bitrate: string;
  startedAt?: string;
}

export const accounts: Account[] = [
  { id: "a1", platform: "instagram", name: "Acme Studio", handle: "@acme.studio", followers: 98400, engagement: 4.2, posts30d: 86, status: "connected", connectedAt: "2026-03-14" },
  { id: "a2", platform: "tiktok", name: "Acme Studio", handle: "@acmestudio", followers: 76200, engagement: 6.8, posts30d: 64, status: "connected", connectedAt: "2026-04-02" },
  { id: "a3", platform: "youtube", name: "Acme Studio", handle: "@AcmeStudio", followers: 41200, engagement: 3.1, posts30d: 18, status: "connected", connectedAt: "2026-02-27" },
  { id: "a4", platform: "facebook", name: "Acme Inc", handle: "@acmeinc", followers: 35800, engagement: 2.4, posts30d: 42, status: "connected", connectedAt: "2026-05-19" },
  { id: "a5", platform: "x", name: "Acme", handle: "@acme", followers: 22100, engagement: 1.9, posts30d: 120, status: "expired", connectedAt: "2026-01-08" },
  { id: "a6", platform: "threads", name: "Acme Studio", handle: "@acme.studio", followers: 10900, engagement: 3.6, posts30d: 54, status: "connected", connectedAt: "2026-06-11" },
];

export const scheduledPosts: ScheduledPost[] = [
  { id: "p1", content: "Product launch week starts Monday. Here's everything shipping in v4.2 — thread below.", platforms: ["x", "threads", "linkedin"], status: "scheduled", scheduledAt: "2026-09-30 09:00" },
  { id: "p2", content: "Behind the scenes: how our design team prototypes in a single afternoon.", platforms: ["instagram", "tiktok"], status: "queued", scheduledAt: "2026-09-30 14:30", media: "bts-reel.mp4" },
  { id: "p3", content: "New tutorial is live — automating your content pipeline end to end.", platforms: ["youtube"], status: "queued", scheduledAt: "2026-10-01 11:00", media: "tutorial-v12.mp4" },
  { id: "p4", content: "September recap: 12 launches, 3M impressions, one very tired team.", platforms: ["instagram", "facebook", "linkedin"], status: "scheduled", scheduledAt: "2026-10-01 17:00", media: "recap-carousel.png" },
  { id: "p5", content: "We asked 500 creators how they plan content. The answers surprised us.", platforms: ["x", "threads"], status: "publishing", scheduledAt: "2026-09-29 08:55" },
  { id: "p6", content: "Live Q&A replay is now available on all channels.", platforms: ["youtube", "facebook"], status: "published", scheduledAt: "2026-09-28 16:00", media: "qa-replay.mp4", engagement: { likes: 2841, comments: 312, shares: 188 } },
  { id: "p7", content: "Flash sale announcement for the EU store.", platforms: ["instagram"], status: "failed", scheduledAt: "2026-09-28 10:00" },
];

export const inboxMessages: InboxMessage[] = [
  { id: "m1", platform: "instagram", author: "Maya Chen", authorHandle: "@maya.creates", text: "This workflow saved me hours every week. Absolute game changer for my small team.", sentiment: "positive", sentimentScore: 0.94, receivedAt: "12 min ago", suggestedReply: "Thank you, Maya! We built it exactly for teams like yours — glad it's paying off.", status: "pending" },
  { id: "m2", platform: "tiktok", author: "Devon Park", authorHandle: "@devonpark", text: "Does this work with scheduled live streams or only regular posts?", sentiment: "neutral", sentimentScore: 0.52, receivedAt: "34 min ago", suggestedReply: "Great question — it supports both. You can schedule live streams from the Live Studio tab and the queue handles the rest.", status: "pending" },
  { id: "m3", platform: "youtube", author: "Sofia Reyes", authorHandle: "@sofiareyes", text: "The auto-reply answered my question in seconds at 2am. Honestly impressed.", sentiment: "positive", sentimentScore: 0.91, receivedAt: "1 hr ago", suggestedReply: "That's the AI doing night shifts so we don't have to. Thanks for the kind words, Sofia.", status: "replied" },
  { id: "m4", platform: "x", author: "Tom Becker", authorHandle: "@tombecker", text: "Upload failed twice this morning and support hasn't responded. Getting frustrated.", sentiment: "negative", sentimentScore: 0.18, receivedAt: "2 hrs ago", suggestedReply: "I'm sorry about that, Tom. I've escalated this to our support team and we'll follow up within the hour.", status: "escalated" },
  { id: "m5", platform: "facebook", author: "Aisha Khan", authorHandle: "@aishakhan", text: "When is the Threads integration getting analytics? Need it for my client report.", sentiment: "neutral", sentimentScore: 0.48, receivedAt: "3 hrs ago", suggestedReply: "Threads analytics is in beta and rolling out to all workspaces this week — I'll make sure yours is enabled.", status: "pending" },
];

export const automationRules: AutomationRule[] = [
  { id: "r1", name: "Comment Auto-Reply", description: "Reply to new comments with AI-generated responses matched to brand tone.", trigger: "New comment", enabled: true, repliesSent: 842, lastTriggered: "8 min ago" },
  { id: "r2", name: "DM Welcome Sequence", description: "Send a welcome message and FAQ links to first-time direct messengers.", trigger: "New DM", enabled: true, repliesSent: 316, lastTriggered: "22 min ago" },
  { id: "r3", name: "Negative Sentiment Escalation", description: "Route comments scoring below 0.3 sentiment to a human reviewer instantly.", trigger: "Sentiment < 0.3", enabled: true, repliesSent: 45, lastTriggered: "2 hrs ago" },
  { id: "r4", name: "Keyword: Pricing", description: "Auto-answer pricing questions with the current plans page link.", trigger: "Keyword match", enabled: false, repliesSent: 128, lastTriggered: "3 days ago" },
  { id: "r5", name: "After-Hours Responder", description: "Acknowledge messages received outside business hours with expected reply time.", trigger: "Schedule", enabled: true, repliesSent: 203, lastTriggered: "Yesterday" },
];

export const streams: StreamSession[] = [
  { id: "s1", title: "Product Demo Loop", source: "demo-loop-4k.mp4", destinations: ["youtube", "facebook"], status: "live", viewers: 1284, uptime: "14:22:08", bitrate: "6.0 Mbps" },
  { id: "s2", title: "Webinar Replay", source: "webinar-replay.mp4", destinations: ["youtube"], status: "scheduled", viewers: 0, uptime: "—", bitrate: "—" },
  { id: "s3", title: "Ambient Brand Loop", source: "brand-ambient.mp4", destinations: ["tiktok", "instagram"], status: "offline", viewers: 0, uptime: "—", bitrate: "—" },
];

export const followerGrowth = [
  { month: "Apr", instagram: 82100, tiktok: 58400, youtube: 36800, x: 19800 },
  { month: "May", instagram: 85400, tiktok: 61900, youtube: 37900, x: 20200 },
  { month: "Jun", instagram: 88900, tiktok: 65300, youtube: 38600, x: 20700 },
  { month: "Jul", instagram: 91200, tiktok: 68900, youtube: 39400, x: 21100 },
  { month: "Aug", instagram: 94800, tiktok: 72100, youtube: 40300, x: 21600 },
  { month: "Sep", instagram: 98400, tiktok: 76200, youtube: 41200, x: 22100 },
];

export const engagementByPlatform = [
  { platform: "TikTok", rate: 6.8, posts: 64 },
  { platform: "Instagram", rate: 4.2, posts: 86 },
  { platform: "Threads", rate: 3.6, posts: 54 },
  { platform: "YouTube", rate: 3.1, posts: 18 },
  { platform: "Facebook", rate: 2.4, posts: 42 },
  { platform: "X", rate: 1.9, posts: 120 },
];

export const weeklyActivity = [
  { day: "Mon", posts: 12, replies: 148 },
  { day: "Tue", posts: 9, replies: 121 },
  { day: "Wed", posts: 14, replies: 176 },
  { day: "Thu", posts: 11, replies: 139 },
  { day: "Fri", posts: 16, replies: 204 },
  { day: "Sat", posts: 8, replies: 98 },
  { day: "Sun", posts: 6, replies: 84 },
];

export const topPosts = [
  { id: "t1", content: "Product launch announcement — v4.0", platform: "tiktok" as PlatformId, reach: 482000, likes: 38400, comments: 2104, shares: 8930 },
  { id: "t2", content: "Behind the scenes studio tour", platform: "instagram" as PlatformId, reach: 296000, likes: 24100, comments: 1893, shares: 4210 },
  { id: "t3", content: "Founder story: how we started", platform: "youtube" as PlatformId, reach: 188000, likes: 12700, comments: 986, shares: 2140 },
  { id: "t4", content: "September product updates thread", platform: "x" as PlatformId, reach: 94000, likes: 5200, comments: 743, shares: 1890 },
];

export function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}
