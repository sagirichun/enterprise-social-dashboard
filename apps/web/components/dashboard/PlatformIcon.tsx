import {
  Facebook,
  Instagram,
  Youtube,
  Twitter,
  AtSign,
  Music2,
  LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { PlatformSlug } from "../../lib/platforms";

const config: Record<
  PlatformSlug,
  { label: string; icon: LucideIcon; bg: string; text: string }
> = {
  facebook: { label: "Facebook", icon: Facebook, bg: "bg-[#1877F2]", text: "text-white" },
  instagram: { label: "Instagram", icon: Instagram, bg: "bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF]", text: "text-white" },
  tiktok: { label: "TikTok", icon: Music2, bg: "bg-zinc-900", text: "text-white" },
  youtube: { label: "YouTube", icon: Youtube, bg: "bg-[#FF0000]", text: "text-white" },
  x: { label: "X", icon: Twitter, bg: "bg-zinc-950", text: "text-white" },
  threads: { label: "Threads", icon: AtSign, bg: "bg-zinc-800", text: "text-white" },
};

interface PlatformIconProps {
  platform: PlatformSlug;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  showLabel?: boolean;
}

const sizes = {
  xs: "h-5 w-5 rounded-md",
  sm: "h-7 w-7 rounded-lg",
  md: "h-9 w-9 rounded-lg",
  lg: "h-11 w-11 rounded-xl",
};

const iconSizes = { xs: 12, sm: 14, md: 17, lg: 20 };

export default function PlatformIcon({
  platform,
  size = "sm",
  className,
  showLabel = false,
}: PlatformIconProps) {
  const c = config[platform];
  const Icon = c.icon;
  return (
    <span className="inline-flex items-center gap-2" title={c.label}>
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center shadow-sm",
          c.bg,
          c.text,
          sizes[size],
          className
        )}
      >
        <Icon size={iconSizes[size]} strokeWidth={2.2} />
      </span>
      {showLabel && (
        <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">{c.label}</span>
      )}
    </span>
  );
}
