import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude-Edit: raw takes in, a finished reel out",
  description: "Drop in your raw talking-head takes. The AI editor picks your best takes, cuts the pauses, adds subtitles, " +
    "pictures and music, and writes your caption. Bring your own Anthropic or OpenAI key. Your videos never leave your browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
