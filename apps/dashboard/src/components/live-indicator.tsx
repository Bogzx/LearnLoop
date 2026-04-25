// Pulsing green dot + "Live" — visible cue that the page is auto-revalidating.
// Spec §13 close ("skill arc visibly ticks up") depends on the audience
// reading "Live" so the tick lands as deliberate motion, not a glitch.

interface LiveIndicatorProps {
  className?: string;
  label?: string;
}

export function LiveIndicator({ className = '', label = 'Live' }: LiveIndicatorProps) {
  return (
    <span className={`inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground ${className}`}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      {label}
    </span>
  );
}
