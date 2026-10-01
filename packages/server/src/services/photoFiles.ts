import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Photo image files on the NAS's disk (PHOTOS_PATH, by default a `photos` folder next to the
 * database). Laid out so they're easy to find in File Station too:
 *   photos/<serial number>/<date>_<check>_<id>.jpg
 * The database keeps each photo's path relative to this folder, so a later serial-number change
 * (667 → 667R) never loses a file. */
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
    await rm(this.abs(file), { force: true });
  }

  /** Danger zone: every photo file goes (the folder itself stays). */
  async removeAll(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.root, { recursive: true });
  }
}
