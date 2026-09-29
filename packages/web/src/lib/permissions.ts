import { useEffect, useState } from "react";
import { DEFAULT_PERMISSIONS, type Permissions } from "@biosite-signoff/shared";
import { getJsonCached, sendJson } from "./client.js";
import { onDataChange } from "./liveEvents.js";

export const fetchPermissions = () => getJsonCached<Permissions>("/api/permissions");
export const savePermissions = (p: Permissions) => sendJson<Permissions>("PUT", "/api/permissions", p);

/** Setup → Security's permission choices (what an operator's screen shows). The server enforces
 * the same rules regardless. */
export function usePermissions(): Permissions {
  const [p, setP] = useState<Permissions>(DEFAULT_PERMISSIONS);
  useEffect(() => {
    const load = () => void fetchPermissions().then(setP, () => {});
    load();
    return onDataChange(load);
  }, []);
  return p;
}

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
