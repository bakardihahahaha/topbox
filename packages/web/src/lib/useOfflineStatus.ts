import { useEffect, useState } from "react";
import { getCachedQueueCount, getRecentQueueFailures, subscribeQueueCount, subscribeQueueFailures } from "./offlineQueue.js";

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

export function useQueueCount(): number {
  const [count, setCount] = useState(getCachedQueueCount());
  useEffect(() => subscribeQueueCount(setCount), []);
  return count;
}

export function useQueueFailures(): string[] {
  const [failures, setFailures] = useState(getRecentQueueFailures());
  useEffect(() => subscribeQueueFailures(setFailures), []);
  return failures;
}
