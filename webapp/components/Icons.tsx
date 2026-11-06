// Cutmind's own small icon set: 24px grid, 1.75 stroke, round caps. Decorative by default (aria-hidden).

const P = {
  home: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10v9h11v-9" /><path d="M10 19v-5h4v5" /></>,
  film: <><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M5 8h3M5 12h3M5 16h3M16 8h3M16 12h3M16 16h3" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  pen: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  spark: <><path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5Z" /><path d="M18.5 16v4M16.5 18h4" /></>,
  sliders: <><path d="M5 7h9M18 7h1M5 17h3M12 17h7" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  upload: <><path d="M12 15V4.5M7.5 9 12 4.5 16.5 9" /><path d="M5 14.5V19h14v-4.5" /></>,
  play: <><path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" stroke="none" /></>,
  pause: <><rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none" /></>,
  stop: <><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  dot: <><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /></>,
  arrowLeft: <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
  arrowRight: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  download: <><path d="M12 4.5V15M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>,
  send: <><path d="M5 12h12M12 6l6 6-6 6" /></>,
  paperclip: <><path d="m19 11.5-6.8 6.8a4.2 4.2 0 0 1-6-6l7.2-7.2a2.8 2.8 0 0 1 4 4l-7 7a1.4 1.4 0 0 1-2-2l6.4-6.4" /></>,
  music: <><path d="M9 17.5V6l10-2v11.5" /><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="16.5" cy="15.5" r="2.5" /></>,
  image: <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m20 15.5-4.5-4.5L7 19" /></>,
  clip: <><rect x="3.5" y="6" width="12" height="12" rx="2" /><path d="m15.5 10.5 5-3v9l-5-3" /></>,
  trash: <><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7" /></>,
  more: <><circle cx="6" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="18" cy="12" r="1.3" fill="currentColor" /></>,
  out: <><path d="M14 4.5h4.5v15H14" /><path d="M10 8l-4 4 4 4M6 12h9" /></>,
  key: <><circle cx="8" cy="15" r="3.5" /><path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5" /></>,
  ear: <><path d="M7 9.5a5 5 0 0 1 10 0c0 3-2.5 3.6-3 6a2.8 2.8 0 0 1-5.3.8" /><path d="M10 10a2 2 0 0 1 4 0" /></>,
  palette: <><path d="M12 4a8 8 0 1 0 0 16c1.2 0 1.6-.9 1.2-1.8-.5-1.1.1-2.2 1.3-2.2H17a3 3 0 0 0 3-3c0-5-3.6-9-8-9Z" /><circle cx="8" cy="11" r="1" fill="currentColor" /><circle cx="11" cy="7.8" r="1" fill="currentColor" /><circle cx="15" cy="8.5" r="1" fill="currentColor" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  alert: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5M12 16h.01" /></>,
  scissors: <><circle cx="6.5" cy="7" r="2.5" /><circle cx="6.5" cy="17" r="2.5" /><path d="M8.5 8.5 19 17M8.5 15.5 19 7" /></>,
  wand: <><path d="m4.5 19.5 11-11M14 5l1-2 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" /></>,
  eye: <><path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  eyeOff: <><path d="M4 4l16 16M10 6.3A9.3 9.3 0 0 1 12 6c5.7 0 9 6 9 6a15 15 0 0 1-2.6 3.3M6.5 7.6C4.2 9.2 3 12 3 12s3.3 6 9 6c1.4 0 2.6-.3 3.7-.9" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      {P[name]}
    </svg>
  );
}

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--accent, #ff7a3d)" />
      <path d="M43 19.5a16 16 0 1 0 0 25" fill="none" stroke="var(--accent-ink, #1c0b02)" strokeWidth="7.5" strokeLinecap="round" />
      <path d="M10 32h44" stroke="var(--accent, #ff7a3d)" strokeWidth="4" />
    </svg>
  );
}
