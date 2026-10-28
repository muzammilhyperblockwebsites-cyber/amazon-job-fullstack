"use client";
import { readApiResponse } from "@/lib/api-response";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import JobCard from "./JobCard";

interface Job {
  id: string;
  scheduleId?: string;
  title: string;
  location: string;
  city?: string;
  category?: string;
  jobType?: string;
  description?: string;
  applyUrl: string;
  postedAt?: string;
  isNew: boolean;
  matchScore: number;
  autoApplied?: boolean;
  appliedAt?: string | null;
  applicationStatus?: string | null;
}

interface ActivePrefs {
  locations?: string[];
  radius?: number;
  keywords?: string[];
  categories?: string[];
  jobTypes?: string[];
  excludeKeywords?: string[];
  minMatchScore?: number;
  postedWithinHours?: number;
  remoteOnly?: boolean;
}

interface FeedResponse {
  jobs: Job[];
  storedAppliedJobs?: Job[];
  bestMatchJob?: Job | null;
  filtersActive?: boolean;
  activePreferences?: ActivePrefs | null;
  total: number;
  totalLiveJobs?: number;
  avgMatchScore?: number;
  page: number;
  totalPages: number;
  source: "live" | "db" | "cache";
}

export interface JobFeedHandle {
  refresh: () => void;
}

type FeedTab = "all" | "new" | "applied";

const JobFeed = forwardRef<JobFeedHandle>((_, ref) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [storedAppliedJobs, setStoredAppliedJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FeedTab>("all");
  const [minScore, setMinScore] = useState(0);
  const [source, setSource] = useState<"live" | "db" | "cache">("live");
  const [activePrefs, setActivePrefs] = useState<ActivePrefs | null>(null);
  const [filtersActive, setFiltersActive] = useState(false);
  const filterOverrideRef = useRef<ActivePrefs | null>(null);

  const fetchJobs = useCallback(
    async (p = 1, silent = false) => {
      if (!silent) setLoading(true);
      try {
        let base = "".replace(
          /\/$/,
          ""
        );
        if (
          typeof window !== "undefined" &&
          window.location.hostname !== "localhost" &&
          window.location.hostname !== "127.0.0.1" &&
          (base.includes("localhost") || base.includes("127.0.0.1"))
        ) {
          base = "";
        }
        const ov = filterOverrideRef.current;
        const params = new URLSearchParams({
          page: String(p),
          limit: "100",
          tab,

          ...(minScore > 0 ? { minScore: String(minScore) } : {}),
          ...(search ? { search } : {}),
          ...(ov
            ? {
                filterOverride: "1",
                locations: JSON.stringify(ov.locations ?? []),
                radius: String(ov.radius ?? 30),
                keywords: JSON.stringify(ov.keywords ?? []),
                categories: JSON.stringify(ov.categories ?? []),
                jobTypes: JSON.stringify(ov.jobTypes ?? []),
              }
            : {}),
        });
        const reqInit: RequestInit = {
          cache: "no-store",
        };
        let res: Response;
        try {
          res = await fetch(`/api/jobs?${params}`, reqInit);
          if (!res.ok && base) {
            res = await fetch(`${base}/api/jobs?${params}`, reqInit);
          }
        } catch {
          res = base
            ? await fetch(`${base}/api/jobs?${params}`, reqInit)
            : await fetch(`/api/jobs?${params}`, reqInit);
        }
        {
          const data: FeedResponse = await readApiResponse(res);
          setFeedError(null);
          setJobs(data.jobs);
          if (Array.isArray(data.storedAppliedJobs)) {
            setStoredAppliedJobs(data.storedAppliedJobs);
          } else if (tab === "applied") {
            setStoredAppliedJobs(data.jobs);
          }
          setTotal(data.total);
          setPage(data.page);
          setTotalPages(data.totalPages);
          setSource(data.source);
          setActivePrefs(data.activePreferences ?? null);
          setFiltersActive(Boolean(data.filtersActive));
          const appliedArr = Array.isArray(data.storedAppliedJobs)
            ? data.storedAppliedJobs
            : tab === "applied"
            ? data.jobs
            : [];
          window.dispatchEvent(
            new CustomEvent("stats-sync", {
              detail: {
                ...(typeof data.totalLiveJobs === "number"
                  ? { totalLiveJobs: data.totalLiveJobs }
                  : {}),
                ...(tab !== "applied" ? { matchingCount: data.total } : {}),
                autoAppliedCount: appliedArr.filter((job: Job) => job.applicationStatus === "applied").length,
                ...(typeof data.avgMatchScore === "number"
                  ? { avgMatchScore: data.avgMatchScore }
                  : {}),
                checkedAt: new Date().toISOString(),
              },
            })
          );
        }
      } catch (error) {
        setFeedError(error instanceof Error ? error.message : "Jobs could not be loaded");
        setJobs([]);
        setTotal(0);
        setSource('db');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [tab, minScore, search]
  );

  // When refresh() is called (e.g. after Save Filters), show loading state so user sees the filtered update
  useImperativeHandle(ref, () => ({ refresh: () => fetchJobs(1, false) }));

  useEffect(() => {
    const onFiltersUpdated = (e: Event) => {
      const detail = (e as CustomEvent<ActivePrefs>).detail;
      if (detail) {
        filterOverrideRef.current = detail;
        setActivePrefs(detail);
        const isCleared =
          (detail.locations?.length ?? 0) === 0 &&
          (detail.keywords?.length ?? 0) === 0 &&
          (detail.categories?.length ?? 0) === 0 &&
          (detail.jobTypes?.length ?? 0) === 0;
        if (isCleared) {
          setSearch("");
          setMinScore(0);
        }
        setPage(1);
        void fetchJobs(1, false);
      }
    };
    window.addEventListener("filters-updated", onFiltersUpdated);
    return () => window.removeEventListener("filters-updated", onFiltersUpdated);
  }, [fetchJobs]);

  useEffect(() => {
    const onStatsReset = () => {
      setStoredAppliedJobs([]);
      if (tab === "applied") {
        setJobs([]);
        setTotal(0);
      } else {
        setJobs((prev) =>
          prev.map((j) => ({
            ...j,
            autoApplied: false,
            applicationStatus: null,
          }))
        );
      }
    };
    window.addEventListener("stats-data-reset", onStatsReset);
    return () => window.removeEventListener("stats-data-reset", onStatsReset);
  }, [tab]);

  useEffect(() => {
    fetchJobs(1);
  }, [fetchJobs]);

  useEffect(() => {
    fetchJobs(page, true);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const markAllSeen = async () => {
    const newJobIds = jobs.filter((j) => j.isNew).map((j) => j.id);
    if (newJobIds.length === 0) return;
    try {
      const base = "".replace(
        /\/$/,
        ""
      );
      await fetch(`${base}/api/jobs/mark-seen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: newJobIds }),
      }).catch(() =>
        fetch(`/api/jobs/mark-seen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobIds: newJobIds }),
        })
      );
      fetchJobs(page);
    } catch {
      // ignore
    }
  };

  const tabCls = (t: FeedTab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      tab === t
        ? "bg-orange-500 text-white"
        : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
    }`;

  const newCount = jobs.filter((j) => j.isNew).length;

  const filterChips: string[] = [];
  if (activePrefs) {
    for (const loc of activePrefs.locations ?? [])
      filterChips.push(`📍 ${loc}`);
    for (const jt of activePrefs.jobTypes ?? [])
      filterChips.push(`🕒 ${jt}`);
    for (const cat of activePrefs.categories ?? [])
      filterChips.push(`📅 ${cat}`);
    for (const kw of activePrefs.keywords ?? [])
      filterChips.push(`👷 ${kw}`);
  }
  if (search) filterChips.push(`🔍 "${search}"`);

  return (
    <div>
      {feedError && <p role="alert" className="border border-red-200 bg-red-50 text-red-800 rounded-lg p-3 mb-3">{feedError}</p>}
      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <button
          className={tabCls("all")}
          onClick={() => {
            setTab("all");
            setPage(1);
          }}
        >
          🌐 Live Feed
        </button>
        <button
          className={tabCls("new")}
          onClick={() => {
            setTab("new");
            setPage(1);
          }}
        >
          🆕 New
        </button>
        <button
          className={tabCls("applied")}
          onClick={() => {
            setTab("applied");
            setPage(1);
          }}
        >
          🚀 Applied {storedAppliedJobs.length > 0 ? `(${storedAppliedJobs.length})` : ""}
        </button>

        <input
          type="text"
          placeholder="Search title, city, category…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px] focus:outline-none focus:ring-2 focus:ring-orange-400"
        />

        <select
          value={minScore}
          onChange={(e) => {
            setMinScore(Number(e.target.value));
            setPage(1);
          }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        >
          <option value={0}>All matches</option>
          <option value={50}>≥ 50%</option>
          <option value={70}>≥ 70%</option>
          <option value={85}>≥ 85%</option>
        </select>

        {newCount > 0 && (
          <button
            onClick={markAllSeen}
            className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors whitespace-nowrap"
          >
            Mark seen ({newCount})
          </button>
        )}

        <button
          onClick={() => fetchJobs(page)}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-50 transition-colors text-sm"
        >
          {loading ? "…" : "↻"}
        </button>
      </div>

      {/* Active Filters Banner */}
      {tab !== "applied" && filterChips.length > 0 && (
        <div className="mb-3 p-3 bg-orange-50 border border-orange-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-orange-800 uppercase tracking-wide mr-1">
              Active Filters:
            </span>
            {filterChips.map((chip, i) => (
              <span
                key={i}
                className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-white text-orange-800 border border-orange-200 shadow-sm"
              >
                {chip}
              </span>
            ))}
          </div>
          <span className="text-xs font-semibold text-orange-700">
            {total} matching job{total !== 1 ? "s" : ""} (Sorted by Highest
            Match)
          </span>
        </div>
      )}

      {/* Source badge + count */}
      {!feedError && <div className="flex items-center gap-3 mb-3">
        <p className="text-xs text-gray-500 font-medium">
          {total.toLocaleString()} {filtersActive ? "filtered " : ""}job
          {total !== 1 ? "s" : ""}
          {total > 0 && ` — page ${page} of ${totalPages}`}
        </p>
        {!feedError && source === "live" && (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
            ● Live from Amazon
          </span>
        )}
        {!feedError && source === 'cache' && <span className="text-xs text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full">Cached official results — refreshing unavailable</span>}
      </div>}

      {/* Feed */}
      {feedError ? null : loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 animate-pulse"
            >
              <div className="flex gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
                <div className="w-12 h-12 rounded-full bg-gray-200" />
              </div>
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-gray-100">
          <p className="text-4xl mb-3">{tab === "applied" ? "🚀" : "📭"}</p>
          <p className="font-medium text-gray-600">
            {tab === "applied"
              ? "No application history yet"
              : "No jobs matched your current filters"}
          </p>
          {tab !== "applied" && (
            <p className="text-xs text-gray-400 mt-1">
              Try broadening your filters or click{" "}
              <strong>Reset</strong> in the Job Filters panel.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="px-4 py-2 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-50"
          >
            ← Prev
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="px-4 py-2 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-50"
          >
            Next →
          </button>
        </div>
      )}

      {/* Stored Auto-Application history Section Below (Nichay Dikhai) */}
      {tab !== "applied" && storedAppliedJobs.length > 0 && (
        <div className="mt-8 pt-6 border-t-2 border-green-200">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4 bg-green-50 border border-green-200 rounded-xl p-4">
            <div>
              <h3 className="text-sm font-bold text-green-900 flex items-center gap-2">
                <span>🚀</span> Saved Application Activity (
                {storedAppliedJobs.length} prepared)
              </h3>
              <p className="text-xs text-green-700 mt-0.5">
                Saved application activity. Availability is checked again before
                opening; expired shifts cannot be reserved from saved history.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTab("applied");
                setPage(1);
              }}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors cursor-pointer"
            >
              View Saved Vault ({storedAppliedJobs.length}) →
            </button>
          </div>

          <div className="space-y-3">
            {storedAppliedJobs.map((job) => (
              <JobCard key={`stored-${job.id}`} job={job} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

JobFeed.displayName = "JobFeed";
export default JobFeed;
