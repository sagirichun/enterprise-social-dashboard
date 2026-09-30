"use client";

import { Smile, Meh, Frown } from "lucide-react";
import Badge from "../ui/Badge";
import { useT } from "../../lib/i18n/LanguageProvider";

interface SentimentBadgeProps {
  sentiment: "positive" | "neutral" | "negative";
  score?: number;
}

const map = {
  positive: { tone: "success" as const, labelKey: "sentiment.positive", Icon: Smile },
  neutral: { tone: "warning" as const, labelKey: "sentiment.neutral", Icon: Meh },
  negative: { tone: "danger" as const, labelKey: "sentiment.negative", Icon: Frown },
};

export default function SentimentBadge({ sentiment, score }: SentimentBadgeProps) {
  const t = useT();
  const { tone, labelKey, Icon } = map[sentiment];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={tone}>
        <Icon size={12} />
        {t(labelKey)}
      </Badge>
      {typeof score === "number" && (
        <span className="tnum text-[11px] text-zinc-400 dark:text-zinc-500">
          {score.toFixed(2)}
        </span>
      )}
    </span>
  );
}
