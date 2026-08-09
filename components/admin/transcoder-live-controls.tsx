"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState, useTransition } from "react";

export function LiveTranscoderRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastRefresh, setLastRefresh] = useState(() => new Date());

  function refresh() {
    if (document.visibilityState !== "visible" || document.querySelector('[data-slot="dialog-content"]')) return;
    startTransition(() => {
      router.refresh();
      setLastRefresh(new Date());
    });
  }

  useEffect(() => {
    const interval = window.setInterval(refresh, 5_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  // The router is stable; registering the timer once avoids resetting it after every refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button className="transcoder-live-refresh" type="button" onClick={refresh} title={`Last refreshed ${lastRefresh.toLocaleTimeString()}`}>
      <i className={pending ? "is-refreshing" : ""}><RefreshCw aria-hidden="true" /></i>
      <span><strong>Live</strong><small>5 second refresh</small></span>
    </button>
  );
}

type FleetFilter = "active" | "attention" | "stopped" | "history" | "all";

export function FleetVisibility({ counts, children }: {
  counts: Record<FleetFilter, number>;
  children: ReactNode;
}) {
  const [filter, setFilter] = useState<FleetFilter>("active");
  const options: Array<{ value: FleetFilter; label: string }> = [
    { value: "active", label: "Active" },
    { value: "attention", label: "Attention" },
    { value: "stopped", label: "Stopped" },
    { value: "history", label: "History" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="transcoder-fleet-view" data-fleet-filter={filter}>
      <div className="transcoder-fleet-filters" role="group" aria-label="Fleet visibility">
        {options.map((option) => (
          <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
            {option.label}<span>{counts[option.value]}</span>
          </button>
        ))}
      </div>
      {counts[filter] > 0 ? children : <div className="admin-empty compact">No fleet records match this view.</div>}
    </div>
  );
}
