import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Photo image files on the NAS's disk (PHOTOS_PATH, by default a `photos` folder next to the
 * database). Laid out so they're easy to find in File Station too:
 *   photos/<serial number>/<date>_<check>_<id>.jpg
 * The database keeps each photo's path relative to this folder, so a later serial-number change
 * (667 → 667R) never loses a file. */
/** What the NAS / Windows / macOS drop into folders by themselves (Synology's @eaDir thumbnail
 * index above all) — a folder holding only these counts as empty. */
const SYSTEM_JUNK = new Set(["@eaDir", "#recycle", "Thumbs.db", "desktop.ini", ".DS_Store"]);

export class PhotoFiles {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  static fileName(serial: string, checkLabel: string, takenAt: string, id: string): string {
    const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
    return `${clean(serial)}/${takenAt.slice(0, 10)}_${clean(checkLabel)}_${id.slice(0, 8)}.jpg`;
  }

  private abs(file: string): string {
    const p = resolve(join(this.root, file));
    if (!p.startsWith(this.root + sep)) throw new Error("Photo path escapes the photos folder");
    return p;
  }

  async write(file: string, data: Buffer): Promise<void> {
    const p = this.abs(file);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  read(file: string): Promise<Buffer> {
    return readFile(this.abs(file));
  }

  async remove(file: string): Promise<void> {
    const p = this.abs(file);
    await rm(p, { force: true });
    // The TopBox's folder goes too once its last photo is gone.
    if (dirname(p) !== this.root) await this.removeIfEmpty(dirname(p));
  }

  /** Deletes a folder that holds no photos any more (system junk like @eaDir doesn't count). */
  private async removeIfEmpty(dir: string): Promise<boolean> {
    const entries = await readdir(dir).catch(() => null);
    if (!entries || entries.some((e) => !SYSTEM_JUNK.has(e))) return false;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return true;
  }

  /** On start-up: removes every TopBox folder left empty (e.g. by an older version). */
  async pruneEmptyFolders(): Promise<number> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    let n = 0;
    for (const e of entries) if (e.isDirectory() && !SYSTEM_JUNK.has(e.name) && (await this.removeIfEmpty(join(this.root, e.name)))) n++;
    return n;
  }

  /** Danger zone: every photo file goes (the folder itself stays). */
  async removeAll(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.root, { recursive: true });
  }
}
