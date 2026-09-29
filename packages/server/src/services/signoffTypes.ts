import { DEFAULT_SIGNOFF_TYPES, allowsRefurbishedR, isOncePerTopbox, modeOf, type SignoffMode, type SignoffType } from "@biosite-signoff/shared";
import type { Store } from "../store/Store.js";
import { badRequest, notFound } from "./errors.js";

export const SIGNOFF_TYPES_KEY = "signoffTypes";

/** The buttons on the New sign-off screen (Setup → Types). Stored as one mirrored app setting. */
export class SignoffTypesService {
  constructor(private readonly store: Store) {}

  async list(): Promise<SignoffType[]> {
    const raw = await this.store.appSettings.get(SIGNOFF_TYPES_KEY);
    return raw ? (JSON.parse(raw) as SignoffType[]) : DEFAULT_SIGNOFF_TYPES;
  }

  async save(types: SignoffType[]): Promise<SignoffType[]> {
    if (types.length === 0) throw badRequest("Keep at least one type.");
    if (types.length > 12) throw badRequest("At most 12 types.");
    const clean = types.map((t) => ({ id: t.id.trim(), name: t.name.trim(), description: t.description.trim(), allowsParts: Boolean(t.allowsParts), oncePerTopbox: isOncePerTopbox(t), refurbishedR: allowsRefurbishedR(t) }));
    if (clean.some((t) => !t.id || !t.name)) throw badRequest("Every type needs a name.");
    if (new Set(clean.map((t) => t.id)).size !== clean.length) throw badRequest("Type ids must be unique.");
    if (new Set(clean.map((t) => t.name.toLowerCase())).size !== clean.length) throw badRequest("Two types have the same name.");
    await this.store.appSettings.set(SIGNOFF_TYPES_KEY, JSON.stringify(clean));
    return clean;
  }

  /** By id; or — for requests from before types existed — the first type matching the old mode. */
  async resolve(input: { typeId?: string; mode?: SignoffMode }): Promise<{ typeId: string; typeName: string; mode: SignoffMode }> {
    const types = await this.list();
    const t = input.typeId ? types.find((x) => x.id === input.typeId) : input.mode ? types.find((x) => modeOf(x) === input.mode) : types[0];
    if (t) return { typeId: t.id, typeName: t.name, mode: modeOf(t) };
    if (input.typeId) throw notFound("Sign-off type");
    // Old client asking for a mode no current type has — keep the record valid anyway.
    return { typeId: "", typeName: "", mode: input.mode ?? "new" };
  }
}
