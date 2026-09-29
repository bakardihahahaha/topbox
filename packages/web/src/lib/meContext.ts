import { createContext, useContext } from "react";
import type { Me } from "./client.js";

export const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside a signed-in session");
  return me;
}
