import type { Metadata, Viewport } from "next";
import { Anton, Inter_Tight, JetBrains_Mono } from "next/font/google";
import AppShell from "@/components/AppShell";
import "./globals.css";

// One typeface for the whole product (Inter Tight), plus a mono for codes in the files view.
const inter = Inter_Tight({ variable: "--font-inter", subsets: ["latin"] });
// Anton: the poster face, used only on the landing page.
const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400" });
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
    <html lang="en" className={`${inter.variable} ${mono.variable} ${anton.variable} h-full`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME }} /></head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
