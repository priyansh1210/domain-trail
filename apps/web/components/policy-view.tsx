// Renders a versioned policy (spec 013 tech §4): headings, paragraphs, lists and tables. Server component.
import type { Policy } from '@/content/policies';

export function PolicyView({ policy }: { policy: Policy }) {
  return (
    <article className="flex flex-col gap-6" data-testid="policy">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{policy.title}</h1>
        <p className="text-sm text-[var(--muted)]">
          Version {policy.version}, effective {policy.effective}
        </p>
      </header>
      {policy.sections.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="flex flex-col gap-2">
          <h2 id={`${s.id}-h`} className="text-lg font-semibold">
            {s.heading}
          </h2>
          {s.paragraphs?.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {s.list && (
            <ul className="list-disc pl-6">
              {s.list.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {s.table && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {s.table.head.map((h) => (
                      <th key={h} scope="col" className="py-2 pr-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.table.rows.map((r) => (
                    <tr key={r.join('|')} className="border-b border-[var(--border)] align-top">
                      {r.map((c, i) => (
                        <td key={i} className="py-2 pr-3">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </article>
  );
}
