import { EngineStatus } from "@/components/EngineStatus";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-4 py-12 sm:px-8">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest opacity-60">
          Chilika Institute of Technology
        </span>
        <h1 className="text-4xl font-bold tracking-tight">CrunchWeek</h1>
        <p className="max-w-2xl text-lg opacity-80">
          One clash-proof schedule for every room, class, exam and Spectra event. Every change is checked
          against the rules before it is saved.
        </p>
      </header>
      <section aria-labelledby="status-heading" className="flex flex-col gap-4">
        <h2 id="status-heading" className="text-lg font-semibold">System status</h2>
        <EngineStatus />
      </section>
    </main>
  );
}
