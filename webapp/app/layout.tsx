import type { Metadata, Viewport } from "next";
import { THEME_BOOT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cutmind: you talk, it cuts",
  description: "Cutmind is a video editor in your browser. Drop in your raw talking-head takes: it keeps your best take of every line, cuts " +
    "the pauses, adds subtitles, pictures and music, and writes your caption. Bring your own Anthropic or OpenAI key. Your videos never leave your browser.",
  openGraph: { title: "Cutmind: you talk, it cuts", type: "website",
    description: "Raw talking-head takes in, a finished captioned reel out. Your videos never leave your browser." },
};

export const viewport: Viewport = { themeColor: "#121110", width: "device-width", initialScale: 1 };

// The app's five looks (Geist, Bricolage + Jakarta, JetBrains Mono, Newsreader, Fraunces + Figtree), the landing page's
// Literata, and Montserrat for burned-in captions. Google Fonts' CSS only declares faces: a browser downloads the
// files of the faces a page actually uses.
const FONTS = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,600..800" +
  "&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Newsreader:opsz,wght@6..72,400..600" +
  "&family=Fraunces:opsz,wght@9..144,500..700&family=Figtree:wght@400;500;600;700" +
  "&family=Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400..500&family=Montserrat:wght@500..900&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="studio" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
