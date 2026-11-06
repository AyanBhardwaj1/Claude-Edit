import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32, unzip, zip } from "../lib/zip";

test("crc32 matches the standard check value", async () => {
  assert.equal(await crc32(new Blob(["123456789"])), 0xcbf43926);
});

test("a backup zip round-trips, and other tools can read it", async () => {
  const video = new Uint8Array(300_000).map((_, i) => (i * 7) % 251);
  const files = [{ name: "manifest.json", data: new Blob(['{"app":"cutmind"}']) }, { name: "media/0", data: new Blob([video]) },
    { name: "média/ünï.txt", data: new Blob(["names in UTF-8"]) }];
  const blob = await zip(files);
  const back = await unzip(blob);
  assert.deepEqual([...back.keys()], ["manifest.json", "media/0", "média/ünï.txt"]);
  assert.equal(await back.get("manifest.json")!.text(), '{"app":"cutmind"}');
  assert.deepEqual(new Uint8Array(await back.get("media/0")!.arrayBuffer()), video);
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  writeFileSync(join(dir, "b.cutmind"), new Uint8Array(await blob.arrayBuffer()));
  try {                                               // Python's zipfile checks every CRC and size
    const out = execFileSync("python3", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() or 'ok', len(z.namelist()))", join(dir, "b.cutmind")]).toString().trim();
    assert.equal(out, "ok 3");
  } catch (e) { if ((e as { code?: string }).code !== "ENOENT") throw e; }
  await assert.rejects(unzip(new Blob(["not a zip at all, definitely not"])), /Not a Cutmind backup/);
  void readFileSync;
});
