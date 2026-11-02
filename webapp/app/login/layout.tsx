import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Sign in · Cutmind" };
export const viewport: Viewport = { themeColor: "#ffffff" };

export default function LoginLayout({ children }: { children: React.ReactNode }) { return children; }
