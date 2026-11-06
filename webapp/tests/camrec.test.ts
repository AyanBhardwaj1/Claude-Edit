import assert from "node:assert/strict";
import test from "node:test";
import { BASIC_CONSTRAINTS, cameraConstraints, cameraErrorMessage, CAMERA_UNSUPPORTED, chooseMimeType, COUNT_MS, COUNTDOWN_FROM, countdownAt,
  countdownLength, DEFAULT_WPM, nextTakeNumber, PrompterClock, promptLines, prompterWords, readingSeconds, scrollOffset, takeFile, takeName,
  wantsPortrait, wordsAt } from "../lib/camrec";
import { MIME_TYPES } from "../lib/screenrec";
import { blankProject, makeReel, titleFor } from "../lib/workflow";
import type { Project, Settings } from "../lib/types";

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test("camrec: teleprompter position at time t for a given speed", () => {
  assert.equal(DEFAULT_WPM, 150);
  assert.equal(wordsAt(60_000, 150), 150);       // a minute at 150 wpm
  assert.equal(wordsAt(1_000, 150), 2.5);         // 2.5 words a second
  assert.equal(wordsAt(-500, 150), 0);
  assert.equal(readingSeconds(300, 150), 120);
  const c = new PrompterClock(150, 1000);
  assert.equal(c.position(5_000), 0);             // not started: stays at the first word
  c.start(1_000);
  assert.equal(c.position(1_000), 0);
  assert.equal(c.position(3_000), 5);             // 2 s at 2.5 words/s
  assert.equal(c.position(25_000), 60);
});

test("camrec: pause, resume and a new speed never make the script jump", () => {
  const c = new PrompterClock(120, 1000);         // 2 words a second
  c.start(0);
  assert.equal(c.position(4_000), 8);
  c.pause(4_000);
  assert.equal(c.running, false);
  assert.equal(c.position(60_000), 8);            // paused for most of a minute: still on word 8
  c.resume(60_000);
  assert.equal(c.position(61_000), 10);           // and on from there
  c.setWpm(240, 61_000);                          // faster from now on
  assert.equal(c.position(61_000), 10);
  assert.equal(c.position(62_000), 14);
  assert.equal(c.toggle(62_000), false);          // toggle pauses...
  assert.equal(c.toggle(63_000), true);           // ...and resumes
  assert.equal(c.position(63_500), 16);
  c.pause(63_500); c.setWpm(60, 70_000);          // a new speed while paused doesn't move it
  assert.equal(c.position(80_000), 16);
  c.reset();
  assert.equal(c.position(90_000), 0);
  // it stops at the end of the script
  const end = new PrompterClock(600, 20);
  end.start(0);
  assert.equal(end.position(1_000), 10);
  assert.equal(end.position(10_000), 20);
  assert.equal(end.done(10_000), true);
  end.setTotal(12, 10_000);                       // the script got shorter
  assert.equal(end.position(10_000), 12);
});

test("camrec: script words, lines and the scroll offset", () => {
  const ws = prompterWords("Hook line here.\n\nSecond  paragraph\nstill second.\r\n\r\nThird");
  assert.deepEqual(ws.map((w) => w.w), ["Hook", "line", "here.", "Second", "paragraph", "still", "second.", "Third"]);
  assert.deepEqual(ws.map((w) => w.para), [false, false, false, true, false, false, false, true]);
  assert.deepEqual(prompterWords("   "), []);
  // tops of 7 words laid out on 3 lines, 48 px apart (a pixel of rounding is the same line)
  const lines = promptLines([0, 0, 1, 48, 48, 96, 96]);
  assert.deepEqual(lines, [{ top: 0, first: 0, count: 3 }, { top: 48, first: 3, count: 2 }, { top: 96, first: 5, count: 2 }]);
  assert.equal(scrollOffset(0, lines), 0);
  assert.ok(near(scrollOffset(1.5, lines), 24));  // half of line 1 read: half way to line 2
  assert.equal(scrollOffset(3, lines), 48);
  assert.equal(scrollOffset(4, lines), 72);
  assert.equal(scrollOffset(6, lines), 96);       // the last line doesn't scroll past itself
  assert.equal(scrollOffset(99, lines), 96);
  assert.equal(scrollOffset(2, []), 0);
  // smooth: it never goes backwards as the words are read
  let last = -1;
  for (let p = 0; p <= 7; p += 0.05) { const y = scrollOffset(p, lines); assert.ok(y >= last); last = y; }
});

test("camrec: takes are called Take 1, Take 2... and a deleted take's number isn't reused", () => {
  assert.equal(takeName(1, "video/webm;codecs=vp9,opus"), "Take 1.webm");
  assert.equal(takeName(2, 'video/mp4;codecs="avc1.640028,mp4a.40.2"'), "Take 2.mp4");
  assert.equal(takeName(3, ""), "Take 3.webm");
  assert.equal(nextTakeNumber([]), 1);
  assert.equal(nextTakeNumber([{ n: 1 }, { n: 2 }]), 3);
  assert.equal(nextTakeNumber([{ n: 2 }]), 3);    // take 1 was deleted: the next is still 3
  const f = takeFile(new Blob(["x"]), 4, "video/webm;codecs=vp8,opus");
  assert.equal(f.name, "Take 4.webm");
  assert.equal(f.type, "video/webm");
});

test("camrec: the recording format is MP4 where the browser makes it, else WebM", () => {
  assert.equal(chooseMimeType(() => true), MIME_TYPES[0]);
  const chrome = new Set(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]);
  assert.equal(chooseMimeType((t) => chrome.has(t)), "video/webm;codecs=vp9,opus");
  assert.equal(chooseMimeType((t) => t === "video/mp4"), "video/mp4");     // Safari
  assert.equal(chooseMimeType(() => false), "");                           // let the browser pick
});

test("camrec: the 3-2-1 countdown", () => {
  assert.equal(COUNTDOWN_FROM, 3);
  assert.equal(countdownLength(), 3 * COUNT_MS);
  assert.deepEqual([0, 999, 1000, 1999, 2000, 2999, 3000, 5000].map((ms) => countdownAt(ms)), [3, 3, 2, 2, 1, 1, 0, 0]);
  assert.equal(countdownAt(NaN), 3);
  assert.equal(countdownAt(-10), 3);
  assert.equal(countdownAt(1500, 5, 500), 2);
});

test("camrec: portrait 1080x1920 on phones, 1920x1080 on a webcam; a cleaned-up microphone", () => {
  assert.equal(wantsPortrait({ width: 390, height: 844 }), true);
  assert.equal(wantsPortrait({ width: 1280, height: 800 }), false);
  assert.equal(wantsPortrait({ width: 800, height: 390, coarse: true }), true);   // a phone held sideways still films for a reel
  assert.equal(wantsPortrait({ width: 1366, height: 1024, coarse: true }), false); // a tablet on a stand
  const p = cameraConstraints(true), l = cameraConstraints(false);
  const pv = p.video as MediaTrackConstraints, lv = l.video as MediaTrackConstraints;
  assert.equal(pv.facingMode, "user");
  assert.deepEqual([pv.width, pv.height], [{ ideal: 1080 }, { ideal: 1920 }]);
  assert.deepEqual([lv.width, lv.height], [{ ideal: 1920 }, { ideal: 1080 }]);
  const a = p.audio as MediaTrackConstraints;
  assert.equal(a.echoCancellation, true);
  assert.equal(a.noiseSuppression, true);
  assert.equal((BASIC_CONSTRAINTS.video as MediaTrackConstraints).facingMode, "user");
});

test("camrec: camera problems in plain words", () => {
  const err = (name: string, message = "") => Object.assign(new Error(message), { name });
  assert.match(cameraErrorMessage(err("NotAllowedError")), /blocked for Cutmind.*allow the camera/);
  assert.match(cameraErrorMessage(err("NotAllowedError", "Permission denied by system")), /System Settings/);
  assert.match(cameraErrorMessage(err("NotFoundError")), /No camera or microphone found/);
  assert.match(cameraErrorMessage(err("NotReadableError")), /in use by another app/);
  assert.match(cameraErrorMessage(err("SecurityError")), /https/);
  assert.equal(cameraErrorMessage(err("TypeError")), CAMERA_UNSUPPORTED);
  assert.match(cameraErrorMessage(err("Weird", "boom")), /\(boom\)/);
  assert.match(cameraErrorMessage(null), /Try again/);
});

test("camrec: filmed takes become a project with the script attached, and listening applies it", async () => {
  // the project itself: named after the script when the takes are just "Take 1", carrying the script
  const p = blankProject([{ name: "Take 2.webm" }], "  I cut my editing time from 3 hours to 20 minutes.\n\nHere's how.  ");
  assert.equal(p.title, "I cut my editing time from 3 hours to 20 minutes.");
  assert.equal(p.script, "I cut my editing time from 3 hours to 20 minutes.\n\nHere's how.");
  assert.equal(p.status, "new");
  assert.equal(blankProject([{ name: "Take 1.mp4" }]).title, "Take 1");
  assert.equal(blankProject([{ name: "Take 1.mp4" }]).script, undefined);
  assert.equal(titleFor([{ name: "my_launch-video.mov" }], "A script"), "my launch video");   // a dropped file keeps its own name
  const long = titleFor([{ name: "Take 1.webm" }], "This is a very long first line of a script that goes on and on past sixty characters");
  assert.ok(long.length <= 61 && long.endsWith("…"), long);

  // the whole new-video run, with each step stubbed: the filmed files go in as takes, the script reaches listen()
  const calls: string[] = [];
  const takes = [takeFile(new Blob(["a"]), 2, "video/webm")];
  const settings = { provider: "anthropic", transcriber: "openai" } as Settings;
  const steps = {
    createProject: async (t: File[], extras: File[], _on: unknown, script = "") => {
      calls.push(`create ${t.map((f) => f.name).join(",")} extras=${extras.length}`);
      const q = blankProject(t, script);
      q.sources = t.map((f, i) => ({ id: i, name: f.name, mediaKey: `${q.id}:take${i}`, duration: 3, width: 1080, height: 1920 }));
      return q;
    },
    listen: async (q: Project, _s: Settings, _on: unknown, script = "") => {
      calls.push(`listen script=${JSON.stringify(script)} attached=${JSON.stringify(q.script)}`);
      return { ok: true, stats: { matched: 6, changed: 2, kept: 0, skipped: 0 }, message: "Fixed 2 words." } as never;
    },
    makeFirstEdit: async () => { calls.push("edit"); return "Here's your first edit."; },
  };
  const progress: string[] = [];
  const res = await makeReel(takes, [], "Hello from Cutmind", settings, [], (m) => progress.push(m), steps as never);
  assert.deepEqual(calls, ["create Take 2.webm extras=0", 'listen script="Hello from Cutmind" attached="Hello from Cutmind"', "edit"]);
  assert.equal(res.project.sources.length, 1);
  assert.equal(res.project.sources[0].name, "Take 2.webm");
  assert.equal(res.summary, "Here's your first edit. Subtitles use your script: Fixed 2 words.");
  assert.equal(progress.at(-1), "Ready");
  // without a script: no script on the project, and the summary is the edit's own
  const plain = await makeReel(takes, [], "", settings, [], () => undefined,
    { ...steps, listen: async () => null } as never);
  assert.equal(plain.project.script, undefined);
  assert.equal(plain.summary, "Here's your first edit.");
});
