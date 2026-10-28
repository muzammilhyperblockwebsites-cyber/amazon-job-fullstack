"use client";

import { useEffect, useRef } from "react";

export type SSEJobEvent = {
  id: string;
  title: string;
  location: string;
  matchScore: number;
  applyUrl: string;
  scheduleId?: string | null;
  category?: string | null;
  jobType?: string | null;
  autoApply: boolean;
};

export type SSEEvent =
  | { type: "connected"; ts: string }
  | { type: "cycle_start" }
  | { type: "heartbeat"; checkedAt: string; totalJobs: number }
  | { type: "new_jobs"; checkedAt: string; jobs: SSEJobEvent[] };

type Handler = (event: SSEEvent) => void;

export function useSSE(onEvent: Handler) {
  const handlerRef = useRef(onEvent);

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      es = new EventSource("/api/stream");

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as SSEEvent;
          handlerRef.current(data);
        } catch {
          /* ignore */
        }
      };

      es.onerror = () => {
        es?.close();
        if (!unmounted) {
          timer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, []);
}
