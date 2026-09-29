import { useCallback, useEffect, useRef, useState } from "react";
import { onDataChange } from "./liveEvents.js";
import { onQueueSynced } from "./offlineQueue.js";
import { errorMessage } from "./ui.js";

/** Load once, then reload whenever any device writes (SSE) or this device's queue drains. */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void reload();
    const a = onDataChange(() => void reload());
    const b = onQueueSynced(() => void reload());
    return () => {
      a();
      b();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, setData, error, setError, reload };
}
