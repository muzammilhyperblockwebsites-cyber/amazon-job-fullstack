"use client";

import { useState } from "react";
import { matchLabel, matchColour } from "@/lib/matcher";
import { launchApplication } from "@/lib/application-launch";

interface Job {
  id: string;
  jobId?: string;
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
  lockedByTool?: boolean;
  removedFromAmazon?: boolean;
  appliedAt?: string | null;
  applicationStatus?: string | null;
}

function timeAgo(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Build an official application link for the selected job and schedule.
export function getDirectAmazonApplyUrl(
  jobId: string,
  fallbackUrl?: string,
  explicitAmazonJobId?: string,
  explicitScheduleId?: string
): string {
  let realId = "";
  if (explicitAmazonJobId && explicitAmazonJobId.startsWith("JOB-")) {
    realId = explicitAmazonJobId;
  } else if (jobId && jobId.startsWith("JOB-")) {
    realId = jobId;
  } else if (fallbackUrl) {
    const match = fallbackUrl.match(/[?&]jobId=([^&#]+)/i);
    if (match?.[1]) {
      realId = decodeURIComponent(match[1]);
    }
  }
  if (!realId) {
    realId = explicitAmazonJobId || jobId;
  }

  let realScheduleId = explicitScheduleId || "";
  if (!realScheduleId && fallbackUrl) {
    const schedMatch = fallbackUrl.match(/[?&]scheduleId=([^&#]+)/i);
    if (schedMatch?.[1]) {
      realScheduleId = decodeURIComponent(schedMatch[1]);
    }
  }

  if (realId) {
    const jId = encodeURIComponent(realId);
    const schedParam = realScheduleId
      ? `&scheduleId=${encodeURIComponent(realScheduleId)}`
      : "";
    return `https://www.jobsatamazon.co.uk/application/uk/?CS=true&jobId=${jId}&locale=en-GB${schedParam}&resumeApplicationLogicOnReturnFromAuth=true#/consent?CS=true&jobId=${jId}&locale=en-GB${schedParam}&resumeApplicationLogicOnReturnFromAuth=true`;
  }
  return fallbackUrl || "https://www.jobsatamazon.co.uk/app#/jobSearch";
}

export default function JobCard({ job }: { job: Job }) {
  const [status, setStatus] = useState(job.applicationStatus || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const applied = status === "applied";
  async function openApplication() {
    setLoading(true);
    setError("");
    try {
      await launchApplication({ ...job, id: job.jobId || job.id });
      setStatus("browser_started");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Activity could not be saved"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm space-y-3">
      <div className="flex justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">{job.title}</h3>
          <p className="text-sm text-gray-600">{job.location}</p>
        </div>
        <span
          className={`rounded-full text-xs text-white px-3 py-2 h-fit ${matchColour(
            job.matchScore
          )}`}
        >
          {job.matchScore}% · {matchLabel(job.matchScore)}
        </span>
      </div>
      {job.description && (
        <p className="text-xs text-gray-500">{job.description}</p>
      )}
      <div className="flex flex-wrap gap-2 text-xs text-gray-600">
        {job.isNew && (
          <span className="text-orange-700 font-semibold">New</span>
        )}
        <span>{job.category}</span>
        <span>{job.jobType}</span>
        {job.postedAt && <span>{timeAgo(job.postedAt)}</span>}
      </div>
      {status && (
        <p className="text-sm font-medium text-green-700">
          {status === "assessment_ready"
            ? "Saved application activity — check progress on Amazon"
            : applied
            ? "✅ Submission verified"
            : "View progress in the tool's Amazon browser"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void openApplication()}
        disabled={loading}
        className="rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm px-4 py-2 disabled:opacity-50 cursor-pointer"
      >
        {loading
          ? "Checking shift & opening Amazon browser…"
          : "Apply automatically to assessment"}
      </button>
    </article>
  );
}
