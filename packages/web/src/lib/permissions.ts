import { useEffect, useState } from "react";
import { getJsonCached } from "./client.js";
import { onDataChange } from "./liveEvents.js";

const fetchSignPolicy = () => getJsonCached<{ operators: number }>("/api/sign-policy");

/** How many operators the system has — drives the cross-check rule on the Sign buttons. */
export function useOperatorCount(): number {
  const [n, setN] = useState(1);
  useEffect(() => {
    const load = () => void fetchSignPolicy().then((p) => setN(p.operators), () => {});
    load();
    return onDataChange(load);
  }, []);
  return n;
}
