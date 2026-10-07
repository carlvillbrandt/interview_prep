/** Skeletons sized to match the real layouts so content swaps in without layout shift. */

export function IndustryPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8" aria-busy="true" aria-label="Loading firms">
      <div className="skeleton h-9 w-28 rounded-full" />
      <div className="skeleton mt-10 h-14 w-2/3 max-w-xl" />
      <div className="skeleton mt-4 h-5 w-1/2 max-w-lg" />
      <div className="skeleton mt-8 h-12 w-full max-w-md rounded-2xl" />
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-[230px] rounded-3xl" />
        ))}
      </div>
    </div>
  );
}

export function InterviewPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8" aria-busy="true" aria-label="Loading interview">
      <div className="skeleton h-9 w-36 rounded-full" />
      <div className="mt-12 flex items-center gap-5">
        <div className="skeleton h-16 w-16 rounded-2xl" />
        <div className="flex-1">
          <div className="skeleton h-10 w-2/3 max-w-md" />
          <div className="skeleton mt-3 h-5 w-1/3 max-w-xs" />
        </div>
      </div>
      <div className="skeleton mt-10 h-64 w-full rounded-3xl" />
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]" aria-hidden>
      <div className="skeleton h-[380px] rounded-3xl" />
      <div className="space-y-4 rounded-3xl border border-line p-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton h-4 w-40" />
            <div className="skeleton mt-2 h-2.5 w-full rounded-full" />
          </div>
        ))}
      </div>
      <div className="skeleton h-48 rounded-3xl lg:col-span-2" />
    </div>
  );
}
