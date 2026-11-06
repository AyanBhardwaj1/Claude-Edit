/** A minimal ZIP (stored, no compression: videos don't compress) writer and reader, for Cutmind backups.
 *  Files are kept as Blobs end to end, so a backup of large videos never needs one huge array in memory. */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export async function crc32(b: Blob): Promise<number> {
  let c = 0xffffffff;
  const step = 8 << 20;                                        // 8 MB at a time
  for (let at = 0; at < b.size; at += step) {
    const bytes = new Uint8Array(await b.slice(at, at + step).arrayBuffer());
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const LIMIT = 0xfffffffe;                                      // no ZIP64: a backup stays under 4 GB

export async function zip(files: { name: string; data: Blob }[], onProgress?: (done: number) => void): Promise<Blob> {
  if (files.length > 0xffff) throw new Error("This backup would hold over 65,535 files: back up fewer videos at a time.");
  const parts: BlobPart[] = [], central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0, i = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name) as Uint8Array<ArrayBuffer>;
    const crc = await crc32(f.data), size = f.data.size;
    if (offset + size + 30 + name.length > LIMIT) throw new Error("This backup would be over 4 GB: back up fewer videos at a time.");
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    const entry = new Uint8Array(46 + name.length); entry.set(new Uint8Array(cd.buffer)); entry.set(name, 46);
    central.push(entry);
    offset += 30 + name.length + size;
    onProgress?.(++i);
  }
  const cdSize = central.reduce((n, e) => n + e.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

/** The files of a stored ZIP made by zip(), as Blob slices of the original (nothing copied). */
export async function unzip(file: Blob): Promise<Map<string, Blob>> {
  if (file.size < 22) throw new Error("Not a Cutmind backup");
  const end = new DataView(await file.slice(file.size - 22).arrayBuffer());
  if (end.getUint32(0, true) !== 0x06054b50) throw new Error("Not a Cutmind backup (or it was changed)");
  const n = end.getUint16(10, true), cdSize = end.getUint32(12, true), cdAt = end.getUint32(16, true);
  const cd = new DataView(await file.slice(cdAt, cdAt + cdSize).arrayBuffer());
  const out = new Map<string, Blob>();
  let p = 0;
  for (let i = 0; i < n; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error("This backup is damaged");
    const method = cd.getUint16(p + 10, true), size = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true), extra = cd.getUint16(p + 30, true), comment = cd.getUint16(p + 32, true);
    const at = cd.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    if (method !== 0) throw new Error("This backup was re-compressed by another app: use the original file");
    const head = new DataView(await file.slice(at, at + 30).arrayBuffer());
    const start = at + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    out.set(name, file.slice(start, start + size));
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
