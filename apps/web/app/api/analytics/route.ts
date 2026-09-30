import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../lib/auth';
import { db } from '../../../lib/db';

/**
 * Analytics overview.
 *
 * Query: ?accountId=<id>&days=30
 * Returns per-account latest snapshots, cross-account totals and a daily
 * series (summed across the selected accounts).
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId');
  const days = Math.min(
    365,
    Math.max(1, Number(searchParams.get('days') ?? 30) || 30),
  );

  const accounts = await db.account.findMany({
    where: {
      userId: user.id,
      ...(accountId ? { id: accountId } : {}),
    },
    select: {
      id: true,
      platform: true,
      profileName: true,
      profileUsername: true,
      profileImage: true,
      isActive: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const accountIds = accounts.map((a) => a.id);

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const snapshots = await db.analyticsSnapshot.findMany({
    where: {
      accountId: { in: accountIds },
      date: { gte: since },
    },
    orderBy: { date: 'asc' },
  });

  // Latest snapshot per account.
  const latestByAccount = new Map<string, (typeof snapshots)[number]>();
  for (const snap of snapshots) {
    latestByAccount.set(snap.accountId, snap);
  }

  // Daily series summed across accounts.
  const seriesByDate = new Map<
    string,
    { date: string; followers: number; engagement: number; impressions: number }
  >();
  for (const snap of snapshots) {
    const key = snap.date.toISOString().slice(0, 10);
    const entry = seriesByDate.get(key) ?? {
      date: key,
      followers: 0,
      engagement: 0,
      impressions: 0,
    };
    entry.followers += snap.followers;
    entry.engagement += snap.engagement;
    entry.impressions += snap.impressions;
    seriesByDate.set(key, entry);
  }
  const series = [...seriesByDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const totals = series.reduce(
    (acc, day) => ({
      followers: Math.max(acc.followers, day.followers),
      engagement: acc.engagement + day.engagement,
      impressions: acc.impressions + day.impressions,
    }),
    { followers: 0, engagement: 0, impressions: 0 },
  );

  const accountSummaries = accounts.map((account) => {
    const latest = latestByAccount.get(account.id) ?? null;
    return {
      ...account,
      latest: latest
        ? {
            date: latest.date,
            followers: latest.followers,
            engagement: latest.engagement,
            impressions: latest.impressions,
            clicks: latest.clicks,
          }
        : null,
    };
  });

  return NextResponse.json({
    accounts: accountSummaries,
    totals,
    series,
    days,
  });
}
