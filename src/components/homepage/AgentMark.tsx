type AgentMarkProps = {
  className?: string;
  label?: string;
};

export function AgentMark({ className = 'size-10', label = 'supermarket.ie grocery agent' }: AgentMarkProps) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${className}`}>
      <svg
        viewBox="0 0 64 64"
        role="img"
        aria-label={label}
        className="h-full w-full"
      >
        <rect width="64" height="64" rx="20" fill="#006A35" />
        <path d="M32 15c0-5 4-8 9-8-1 5-4 8-9 8Z" fill="#6BFE9C" />
        <path d="M19 25c0-4 3-7 7-7h12c4 0 7 3 7 7l3 24c.5 4-2.5 7-6.5 7h-19c-4 0-7-3-6.5-7l3-24Z" fill="#FFF7E6" />
        <path d="M25 27c0-4 3-7 7-7s7 3 7 7" fill="none" stroke="#006A35" strokeWidth="3" strokeLinecap="round" />
        <circle cx="27" cy="37" r="2.4" fill="#2F2F2E" />
        <circle cx="38" cy="37" r="2.4" fill="#2F2F2E" />
        <path d="M28 44c2.7 2.5 5.3 2.5 8 0" fill="none" stroke="#2F2F2E" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="22.5" cy="43" r="2" fill="#9D2F62" opacity=".72" />
        <path d="m49 13 1.5 3.5L54 18l-3.5 1.5L49 23l-1.5-3.5L44 18l3.5-1.5L49 13Z" fill="#FFD84D" />
      </svg>
    </span>
  );
}
