/** Plays a listening track from a short-lived signed link. */
export function ListeningPlayer({ src, className = "w-full" }: { src: string; className?: string }) {
  return <audio controls preload="metadata" controlsList="nodownload noplaybackrate" src={src} className={className} />;
}
