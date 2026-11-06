// Loudness for finished audio, as the desktop composer measures it (editor/compose/dsp.py lufs_of / limit):
// integrated LUFS after ITU-R BS.1770-4 (K-weighting, 400 ms blocks every 100 ms, absolute -70 and relative -10 gates),
// sample peak, and a look-ahead peak limiter. Pure functions on Float32Array channels, so they run in node tests too.

export type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** The two K-weighting stages for a sample rate: a +4 dB high shelf ("head") then the RLB high-pass. */
export function kWeighting(rate: number): [Biquad, Biquad] {
  // the shelf (pre-filter), from the BS.1770 analogue prototype as libebur128 / pyloudnorm compute it
  let f0 = 1681.974450955533, q = 0.7071752369554196;
  const G = 3.999843853973347;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / q + K * K;
  const shelf = { b0: (Vh + (Vb * K) / q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0, a2: (1 - K / q + K * K) / a0 };
  f0 = 38.13547087602444; q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / q + K * K;
  const hp = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / q + K * K) / a0 };
  return [shelf, hp];
}

/** Integrated loudness in LUFS of one or two channels (stereo channels weigh 1 each). -70 for silence. */
export function integratedLufs(channels: Float32Array[], rate: number): number {
  const n = channels[0]?.length ?? 0;
  const hop = Math.round(rate / 10);
  const m = Math.floor(n / hop);
  if (m < 4) return -70;
  const [s, h] = kWeighting(rate);
  const sums = new Float64Array(m);               // K-weighted energy per 100 ms, summed over channels
  for (const x of channels) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let i = 0, blk = 0, k = 0; blk < m; i++) {
      const xi = x[i];
      const y = s.b0 * xi + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
      const z = y - 2 * y1 + y2 - h.a1 * z1 - h.a2 * z2;     // the high-pass (b = 1, -2, 1) runs on the shelf's output
      x2 = x1; x1 = xi; y2 = y1; y1 = y; z2 = z1; z1 = z;
      sums[blk] += z * z;
      if (++k === hop) { k = 0; blk++; }
    }
  }
  return gate(sums, hop);
}

function gate(sums: Float64Array, hop: number): number {
  const m = sums.length;
  const z = new Float64Array(m - 3);
  for (let b = 0; b + 3 < m; b++) z[b] = (sums[b] + sums[b + 1] + sums[b + 2] + sums[b + 3]) / (4 * hop);
  const L = (p: number) => -0.691 + 10 * Math.log10(Math.max(p, 1e-20));
  let sum = 0, cnt = 0;
  for (const p of z) if (L(p) > -70) { sum += p; cnt++; }
  if (!cnt) return -70;
  const rel = L(sum / cnt) - 10;
  sum = 0; cnt = 0;
  for (const p of z) if (L(p) > -70 && L(p) > rel) { sum += p; cnt++; }
  return cnt ? L(sum / cnt) : -70;
}

/** Highest absolute sample over all channels, in dBFS (-120 for silence). */
export function samplePeakDb(channels: Float32Array[]): number {
  let pk = 0;
  for (const x of channels) for (let i = 0; i < x.length; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > pk) pk = a; }
  return pk > 0 ? 20 * Math.log10(pk) : -120;
}

export const dbToGain = (db: number) => 10 ** (db / 20);

/** Look-ahead peak limiter in place: gain is planned per 1 ms block (the lowest gain any neighbouring block needs,
 *  released at `releaseDbPerS`) and interpolated between blocks, so no sample ends above the ceiling. */
export function limitPeaks(channels: Float32Array[], rate: number, ceilingDb: number, releaseDbPerS = 120): void {
  const n = channels[0]?.length ?? 0;
  const c = dbToGain(ceilingDb);
  const B = Math.max(1, Math.round(rate / 1000));
  const m = Math.ceil(n / B);
  const need = new Float64Array(m).fill(1);
  for (const x of channels) {
    for (let b = 0; b < m; b++) {
      let pk = 0;
      for (let i = b * B, e = Math.min(n, i + B); i < e; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > pk) pk = a; }
      if (pk > c) need[b] = Math.min(need[b], c / pk);
    }
  }
  const g = new Float64Array(m);
  for (let b = 0; b < m; b++) g[b] = Math.min(need[b], b > 0 ? need[b - 1] : 1, b + 1 < m ? need[b + 1] : 1);
  const step = dbToGain((releaseDbPerS * B) / rate);           // gain may rise by this factor per block
  for (let b = 1; b < m; b++) g[b] = Math.min(g[b], g[b - 1] * step);          // release
  for (let b = m - 2; b >= 0; b--) g[b] = Math.min(g[b], g[b + 1] * step);     // and a matching attack ahead of a peak
  let any = false;
  for (let b = 0; b < m; b++) if (g[b] < 1) { any = true; break; }
  if (!any) return;
  for (const x of channels) {
    for (let i = 0; i < n; i++) {
      const pos = i / B - 0.5, b = Math.max(0, Math.min(m - 1, Math.floor(pos)));
      const f = Math.max(0, Math.min(1, pos - b));
      const gi = g[b] + (g[Math.min(m - 1, b + 1)] - g[b]) * f;
      const y = x[i] * gi;
      x[i] = y > c ? c : y < -c ? -c : y;
    }
  }
}

/** Gain to an integrated loudness, then the peak ceiling; a second pass makes up what the limiter took. In place. */
export function normalise(channels: Float32Array[], rate: number, targetLufs = -16, ceilingDb = -1.5):
  { lufs: number; peakDb: number; gainDb: number } {
  let total = 0;
  for (let pass = 0; pass < 6; pass++) {
    const now = integratedLufs(channels, rate);
    if (now <= -70) break;
    const gdb = targetLufs - now;
    if (pass > 0 && Math.abs(gdb) < 0.2) break;
    const g = dbToGain(gdb);
    for (const x of channels) for (let i = 0; i < x.length; i++) x[i] *= g;
    total += gdb;
    limitPeaks(channels, rate, ceilingDb);
  }
  return { lufs: integratedLufs(channels, rate), peakDb: samplePeakDb(channels), gainDb: total };
}
