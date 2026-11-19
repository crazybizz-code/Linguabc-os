/** Shown instantly while a portal page loads. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className={`rounded-[18px] bg-[#FCF8F4] ${i === 0 ? "h-28" : "h-40"}`} />)}
    </div>
  );
}
