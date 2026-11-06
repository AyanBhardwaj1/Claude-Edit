// Accessibility audit (axe-core, WCAG 2.1 AA + best practice) of the landing page, sign-up, the app screens in a light
// and a dark look, the editor and its panels. Start the app first (npm run build && npx next start -p 3370), then:
// npm run a11y [-- <port> <outdir>]   (exit code 1 when anything fails)
const { chromium } = require("playwright");
const fs = require("fs");
const PORT = process.argv[2] || "3370", OUT = process.argv[3] || ".";
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

(async () => {
  // a fake camera and microphone, so "Film it here" opens with a live preview
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const results = [];
  const audit = async (name) => {
    await page.addScriptTag({ content: AXE });
    const r = await page.evaluate(async () => {
      const res = await window.axe.run(document, { resultTypes: ["violations"],
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help,
        nodes: v.nodes.slice(0, 4).map((n) => n.target.join(" ") + " :: " + (n.failureSummary || "").split("\n").slice(1, 2).join(" ")) }));
    });
    results.push({ name, violations: r });
    console.log(`${name}: ${r.length} violation(s)` + (r.length ? "\n  " + r.map((v) => `[${v.impact}] ${v.id}: ${v.help}\n     ${v.nodes.join("\n     ")}`).join("\n  ") : ""));
  };
  const theme = (t) => page.evaluate((t) => { document.documentElement.dataset.theme = t; }, t);

  await page.goto(BASE + "/"); await page.waitForTimeout(1500); await audit("landing");
  await page.goto(BASE + "/login?mode=signup"); await page.waitForTimeout(800); await audit("signup");
  await page.getByLabel("Your name").fill("Audit Person");
  await page.getByLabel("Email").fill(`audit-${Date.now()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("reels4ever!");
  await page.getByRole("button", { name: "Create my account" }).click();
  await page.waitForURL("**/app**"); await page.waitForTimeout(1500);
  for (const t of ["radiant", "studio"]) {
    await theme(t);
    await page.goto(BASE + "/app"); await page.waitForTimeout(1200); await theme(t); await page.waitForTimeout(600); await audit(`home (${t})`);
    await page.goto(BASE + "/app#new"); await page.waitForTimeout(1200); await theme(t); await audit(`new video (${t})`);
    await page.getByRole("button", { name: "Film it here" }).click();
    await page.locator(".film-recbtn:not([disabled])").waitFor({ timeout: 15000 }).catch(() => undefined);
    await page.getByRole("textbox", { name: "Your script" }).fill("Hi, I'm filming this inside Cutmind.\n\nThe script scrolls while I talk.");
    await page.waitForTimeout(400); await audit(`film it here (${t})`);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.goto(BASE + "/app#settings"); await page.waitForTimeout(1200); await theme(t); await audit(`settings (${t})`);
    await page.goto(BASE + "/app#animate"); await page.waitForTimeout(1500); await theme(t); await audit(`animate (${t})`);
  }
  await page.goto(BASE + "/app"); await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /Open the sample/ }).first().click();
  await page.getByRole("button", { name: "Edit it myself" }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500); await audit("editor");
  const mm = page.getByRole("button", { name: /Make music/ }).first();
  if (await mm.count()) { await mm.click(); await page.waitForTimeout(800); await audit("make music panel"); await page.keyboard.press("Escape"); }
  const rec = page.getByRole("button", { name: "Record my screen" });
  if (await rec.count()) { await rec.first().click(); await page.waitForTimeout(800); await audit("record screen panel"); await page.keyboard.press("Escape"); }
  await page.getByRole("button", { name: "Edit it myself" }).click(); await page.waitForTimeout(1200); await audit("edit it myself");
  // an uploaded screen recording with a frozen middle: "Speed through waits" in Pictures (needs ffmpeg to make the clip)
  const clip = `${OUT}/a11y_screen_wait.mp4`;
  const made = require("child_process").spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xf4f5f7:s=1280x720:r=30:d=6",
    "-f", "lavfi", "-i", "color=c=0x10b981:s=220x120:r=30:d=6", "-filter_complex",
    "[0:v]drawbox=x=0:y=0:w=1280:h=64:color=0x1f2937:t=fill[bg];[bg][1:v]overlay=x='300+300*if(lt(t,2),t,if(lt(t,4),2,t-2))':y=220:shortest=1[v]",
    "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
  if (made.status === 0) {
    await page.locator('input[type="file"][accept="audio/*,image/*,video/*"]').setInputFiles(clip);
    await page.getByText(/I found a wait in a11y_screen_wait/).waitFor({ timeout: 60000 }).catch(() => undefined);
    await page.getByRole("tab", { name: "Pictures" }).click(); await page.waitForTimeout(800);
    await audit(`pictures, speed through waits (${await page.locator(".waits").count()} clip)`);
  } else console.log("pictures, speed through waits: skipped (no ffmpeg to make a test clip)");
  // with a finished video in the account: the tiles, badges and "Your reels" only show then
  await page.goto(BASE + "/app"); await page.waitForTimeout(1200); await audit("home (with a video)");
  await page.goto(BASE + "/app#videos"); await page.waitForTimeout(1000); await audit("my videos (with a video)");
  fs.writeFileSync(`${OUT}/a11y.json`, JSON.stringify(results, null, 1));
  process.exitCode = results.some((r) => r.violations.length) ? 1 : 0;
  await b.close();
})();
