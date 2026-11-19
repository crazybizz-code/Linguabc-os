/** Shown instantly while a staff page loads, so navigation never looks frozen. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-3 w-28 rounded-full bg-[#E9DFD7]" />
        <div className="h-7 w-64 rounded-full bg-[#E9DFD7]" />
        <div className="h-3 w-96 max-w-full rounded-full bg-[#EFE6DF]" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-[18px] bg-[#F3EBE5]" />)}
      </div>
      <div className="space-y-2 rounded-[18px] border border-border/60 bg-[#FCF8F4] p-5">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 rounded-[10px] bg-[#F3EBE5]" />)}
      </div>
    </div>
  );
}
