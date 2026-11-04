// The brand kit: name, @handle, two colours, a font and a logo. The compositor and Motion Studio read it from here.

import { getMedia } from "./store";
import type { Brand } from "./types";

export const DEFAULT_BRAND: Brand = { name: "", handle: "", accent: "#FF7A3D", accent2: "#FFD166", font: "Montserrat", watermark: false };
export const brandOf = (b?: Brand): Brand => ({ ...DEFAULT_BRAND, ...(b ?? {}) });
export const hasBrand = (b?: Brand) => !!b && (!!b.name.trim() || !!b.handle.trim() || !!b.logo);

let current: { brand: Brand; logo: HTMLImageElement | null } = { brand: DEFAULT_BRAND, logo: null };
let loadedKey: string | undefined;

/** Make this brand the one frames are drawn with (loads the logo once). */
export async function applyBrand(b?: Brand) {
  const brand = brandOf(b);
  if (brand.logo !== loadedKey) {
    loadedKey = brand.logo;
    current.logo = null;
    const blob = brand.logo ? await getMedia(brand.logo) : undefined;
    if (blob) {
      const img = new Image(); img.src = URL.createObjectURL(blob);
      await img.decode().catch(() => undefined);
      current.logo = img;
    }
  }
  current = { brand, logo: current.logo };
}
export const activeBrand = () => current;

/** A small corner mark: the logo and/or @handle, top right, quiet. */
export function drawWatermark(g: CanvasRenderingContext2D, W: number, H: number) {
  const { brand, logo } = current;
  if (!brand.watermark || (!logo && !brand.handle.trim())) return;
  const U = Math.min(W, H), pad = 0.035 * U, size = 0.07 * U;
  g.save(); g.globalAlpha = 0.82;
  let x = W - pad;
  const y = (H > W ? 0.06 : 0.05) * H;
  if (brand.handle.trim()) {
    g.font = `700 ${0.032 * U}px Montserrat, Arial, sans-serif`; g.textAlign = "right"; g.textBaseline = "middle";
    const h = brand.handle.startsWith("@") ? brand.handle : `@${brand.handle}`;
    g.lineWidth = 0.006 * U; g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineJoin = "round"; g.strokeText(h, x, y + size / 2);
    g.fillStyle = "#fff"; g.fillText(h, x, y + size / 2);
    x -= g.measureText(h).width + 0.015 * U;
  }
  if (logo && logo.naturalWidth) {
    const s = Math.min(size / logo.naturalHeight, (size * 2.4) / logo.naturalWidth);
    const w = logo.naturalWidth * s, h = logo.naturalHeight * s;
    g.drawImage(logo, x - w, y + (size - h) / 2, w, h);
  }
  g.restore();
}
