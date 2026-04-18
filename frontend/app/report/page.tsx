import { SiteShell } from "@/components/layout/site-shell";
import { reportBars, reportSummary } from "@/lib/demo-data";

const staggerClasses = ["stagger-1", "stagger-2", "stagger-3"];

export default function ReportPage() {
  return (
    <SiteShell
      eyebrow="Performance Report"
      title="Make the diagnosis unforgettable."
      description="The architecture’s wow moment lives here: topic weakness, time behavior, and next actions rendered like a serious coaching system."
    >
      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="surface page-reveal rounded-[30px] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-signal">
            Coach headline
          </p>
          <h2 className="mt-4 max-w-3xl font-display text-4xl leading-none md:text-6xl">
            Strong conceptual base, but weak conversion under pressure.
          </h2>
          <p className="mt-6 max-w-2xl text-base leading-8 text-muted">
            Accuracy holds in Mechanics, but timing and decision quality drop late in the
            attempt. The system should now turn those patterns into a short plan the
            student can act on today.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {reportSummary.map((item, index) => (
              <div
                key={item.label}
                className={`page-reveal ${staggerClasses[index] ?? ""} rounded-[22px] border border-line bg-white/[0.02] p-5`}
              >
                <p className="text-sm text-muted">{item.label}</p>
                <p className="mt-3 font-display text-4xl">{item.value}</p>
                <p className="mt-2 text-sm text-white/70">{item.note}</p>
              </div>
            ))}
          </div>
        </article>

        <aside className="surface page-reveal stagger-2 rounded-[30px] p-6 md:p-8">
          <div className="grid gap-6">
            {reportBars.map((group) => (
              <section key={group.title}>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h3 className="font-display text-2xl">{group.title}</h3>
                  <span className="font-mono text-xs uppercase tracking-[0.22em] text-muted">
                    {group.caption}
                  </span>
                </div>

                <div className="grid gap-4">
                  {group.items.map((item) => (
                    <div key={item.label}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-white/90">{item.label}</span>
                        <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
                          {item.valueLabel}
                        </span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-white/[0.05]">
                        <div className="metric-bar h-full rounded-full" style={{ width: item.value }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </aside>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-3">
        <article className="surface page-reveal stagger-1 rounded-[26px] p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-signal">
            Strengths
          </p>
          <ul className="mt-5 space-y-3 text-sm leading-7 text-muted md:text-base">
            <li>You are solving Mechanics questions with stable confidence.</li>
            <li>You still convert medium difficulty when you answer early.</li>
          </ul>
        </article>

        <article className="surface page-reveal stagger-2 rounded-[26px] p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-warning">
            Weaknesses
          </p>
          <ul className="mt-5 space-y-3 text-sm leading-7 text-muted md:text-base">
            <li>Electrostatics needs more medium-level repetition.</li>
            <li>Hard questions are consuming too much first-pass time.</li>
          </ul>
        </article>

        <article className="surface page-reveal stagger-3 rounded-[26px] p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-signal">
            Action plan
          </p>
          <ul className="mt-5 space-y-3 text-sm leading-7 text-muted md:text-base">
            <li>Practice 10 Electrostatics questions daily for 3 days.</li>
            <li>Cap first-pass time on hard items at 2 minutes.</li>
            <li>Review formulas before the next timed mock.</li>
          </ul>
        </article>
      </section>
    </SiteShell>
  );
}
