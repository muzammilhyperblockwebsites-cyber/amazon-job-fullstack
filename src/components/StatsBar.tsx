"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSSE } from "@/hooks/useSSE";
import { readApiResponse } from '@/lib/api-response';

interface Stats {
  totalJobs: number | null;
  matchingJobs?: number | null;
  newToday: number | null;
  avgMatchScore: number | null;
  lastChecked: string | null;
  isMonitoring: boolean;
  autoAppliedTotal: number | null;
  jobFeed?: { provider: string; stale: boolean; available?: boolean; fetchedAt?: string };
}

interface FilterOverride {
  locations?: string[];
  radius?: number;
  keywords?: string[];
  categories?: string[];
  jobTypes?: string[];
}

function timeAgo(isoStr: string): string {
  const diff = Math.max(
    0,
    Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  );
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function StatsBar({ onReset }: { onReset?: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const [resetting, setResetting] = useState(false);
  const [, setTick] = useState(0);
  const filterOverrideRef = useRef<FilterOverride | null>(null);

  const getBackendBase = useCallback(() => {
    const raw = "".replace(/\/$/, "");
    if (!raw) return "";
    if (
      typeof window !== "undefined" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1" &&
      (raw.includes("localhost") || raw.includes("127.0.0.1"))
    ) {
      return "";
    }
    return raw;
  }, []);

  const fetchStats = useCallback(async () => {
    const generation = ++requestGeneration.current;
    try {
      const base = getBackendBase();
      const ov = filterOverrideRef.current;
      const params = new URLSearchParams(
        ov
          ? {
              filterOverride: "1",
              locations: JSON.stringify(ov.locations ?? []),
              radius: String(ov.radius ?? 30),
              keywords: JSON.stringify(ov.keywords ?? []),
              categories: JSON.stringify(ov.categories ?? []),
              jobTypes: JSON.stringify(ov.jobTypes ?? []),
            }
          : {}
      );
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/stats${qs}`, { cache: "no-store" }).catch(
        () =>
          base
            ? fetch(`${base}/api/stats${qs}`, { cache: "no-store" })
            : null
      );
      if (!res) throw new Error('The job-count request failed. Please retry.');
      if (res) {
        const data = await readApiResponse(res);
        if (generation !== requestGeneration.current) return;
        setStatsError(data.availabilityError || null);
        setStats(data);
      }
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setStatsError(error instanceof Error ? error.message : 'Official UK job counts are unavailable');
      setStats(null);
    }
  }, [getBackendBase]);

  const handleReset = async () => {
    setResetting(true);
    try {
      const response = await fetch('/api/stats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!response.ok) throw new Error('Reset failed. Please retry.');
      setStats((prev) =>
        prev
          ? {
              ...prev,
              totalJobs: 0,
              matchingJobs: 0,
              newToday: 0,
              avgMatchScore: 0,
              autoAppliedTotal: 0,
            }
          : null
      );
      window.dispatchEvent(new CustomEvent("stats-data-reset"));
      onReset?.();
    } catch {
      window.alert('Stats could not be reset. Please retry.');
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => fetchStats());
    const handleRefresh = () => {
      void fetchStats();
    };
    const handleFiltersUpdated = (e: Event) => {
      const detail = (e as CustomEvent<FilterOverride>).detail;
      if (detail) {
        filterOverrideRef.current = detail;
      }
      void fetchStats();
    };
    const handleStatsSync = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          totalLiveJobs?: number;
          matchingCount?: number;
          autoAppliedCount?: number;
          avgMatchScore?: number;
          checkedAt?: string;
        }>
      ).detail;
      if (!detail) return;
      requestGeneration.current++;
      setStatsError(null);
      setStats((prev) => ({
        totalJobs:
          typeof detail.totalLiveJobs === "number"
            ? detail.totalLiveJobs
            : prev?.totalJobs ?? 0,
        matchingJobs:
          typeof detail.matchingCount === "number"
            ? detail.matchingCount
            : prev?.matchingJobs ?? prev?.newToday ?? 0,
        newToday:
          typeof detail.matchingCount === "number"
            ? detail.matchingCount
            : prev?.newToday ?? 0,
        avgMatchScore:
          typeof detail.avgMatchScore === "number"
            ? detail.avgMatchScore
            : prev?.avgMatchScore ?? 0,
        autoAppliedTotal:
          typeof detail.autoAppliedCount === "number"
            ? detail.autoAppliedCount
            : prev?.autoAppliedTotal ?? 0,
        lastChecked:
          detail.checkedAt ?? prev?.lastChecked ?? new Date().toISOString(),
        isMonitoring: true,
      }));
    };

    window.addEventListener("stats-refresh", handleRefresh);
    window.addEventListener("filters-updated", handleFiltersUpdated);
    window.addEventListener("stats-sync", handleStatsSync);
    const interval = setInterval(handleRefresh, 15000);
    const tickInterval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => {
      window.removeEventListener("stats-refresh", handleRefresh);
      window.removeEventListener("filters-updated", handleFiltersUpdated);
      window.removeEventListener("stats-sync", handleStatsSync);
      clearInterval(interval);
      clearInterval(tickInterval);
    };
  }, [fetchStats]);

  useSSE(
    useCallback(
      (event) => {
        if (event.type === "new_jobs" || event.type === "heartbeat") {
          void fetchStats();
        }
      },
      [fetchStats]
    )
  );

  if (!stats) {
    if (statsError) return <p role="alert" className="border border-red-200 bg-red-50 text-red-800 rounded-lg p-3 mb-5">{statsError}</p>;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl p-4 shadow-sm animate-pulse"
          >
            <div className="h-3 bg-gray-200 rounded w-3/4 mb-2" />
            <div className="h-7 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: "Jobs Tracked",
      value: stats.totalJobs?.toLocaleString() ?? '—',
      sub: stats.jobFeed?.available === false ? 'Live count temporarily unavailable' : stats.jobFeed?.stale ? 'Cached official UK hourly jobs' : 'Official UK hourly job cards',
      icon: "💼",
      colour: "text-blue-600",
    },
    {
      label: "Matched Filter",
      value: (stats.matchingJobs ?? stats.newToday)?.toLocaleString() ?? '—',
      sub: "Matching your filter",
      icon: "🆕",
      colour: "text-green-600",
    },
    {
      label: "Avg Match",
      value: stats.avgMatchScore == null ? '—' : `${stats.avgMatchScore}%`,
      sub: "Filter match score",
      icon: "🎯",
      colour: "text-orange-500",
    },
    {
      label: "Verified submissions",
      value: stats.autoAppliedTotal?.toLocaleString() ?? '—',
      sub: stats.lastChecked
        ? `Last check ${timeAgo(stats.lastChecked)}`
        : "Saved application records",
      icon: "🚀",
      colour: "text-purple-600",
    },
  ];

  return (
    <div className="mb-5">
      {statsError && <p role="status" className="border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-3 mb-3">{statsError} Live counts will return when Amazon allows verification.</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <span>{c.icon}</span>
                {c.label}
              </p>
              {c.label === "Verified submissions" && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={resetting}
                  className="text-[11px] font-semibold px-2 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors cursor-pointer"
                  title="Reset all tracked and applied jobs data to 0"
                >
                  {resetting ? "Resetting…" : "Reset Data"}
                </button>
              )}
            </div>
            <p className={`text-2xl font-bold mt-1 ${c.colour}`}>{c.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
