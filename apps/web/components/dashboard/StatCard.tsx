import { LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "../../lib/utils";
import Card from "../ui/Card";

interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
  icon: LucideIcon;
  hint?: string;
}

export default function StatCard({
  label,
  value,
  delta,
  deltaPositive,
  icon: Icon,
  hint,
}: StatCardProps) {
  return (
    <Card className="animate-fade-up" padded={false}>
      <div className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon size={16} />
          </span>
        </div>
        <p className="tnum mt-2 text-[26px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {value}
        </p>
        {delta && (
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                deltaPositive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
              )}
            >
              {deltaPositive ? (
                <TrendingUp size={12} />
              ) : (
                <TrendingDown size={12} />
              )}
              {delta}
            </span>
            {hint && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</span>
            )}
          </div>
        )}
        {!delta && hint && (
          <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</p>
        )}
      </div>
    </Card>
  );
}
