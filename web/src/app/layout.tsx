import type { Metadata, Viewport } from "next";
import { Inter_Tight, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import AppShell from "@/components/AppShell";
import "./globals.css";

// The CrunchWeek type system: Inter Tight for reading, Instrument Serif for the big editorial
// moments, JetBrains Mono for anything that is a time, a room or a code.
const inter = Inter_Tight({ variable: "--font-inter", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const mono = JetBrains_Mono({ variable: "--font-jbmono", subsets: ["latin"], weight: ["400", "500"] });

// Every page is a signed-in client view that loads live data from the engine,
// so navigations are not expected to be instant (this silences the dev-only check).
export const instant = false;

export const metadata: Metadata = {
  title: "CrunchWeek · CIT Scheduling",
  description: "Clash-proof timetable, midsem exams, Spectra venue booking and disruption repair for CIT",
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#efe9dc" }, { media: "(prefers-color-scheme: dark)", color: "#091114" }],
};

// Applies a saved Light/Dark choice before first paint, so there is no flash.
const THEME = `try{var t=localStorage.getItem("cw-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME }} /></head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
