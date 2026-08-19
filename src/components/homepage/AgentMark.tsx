type AgentMarkProps = {
  className?: string;
  label?: string;
};

export function AgentMark({ className = 'size-10', label = 'supermarket.ie supermarket agent' }: AgentMarkProps) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${className}`}>
      <svg
        viewBox="0 0 64 64"
        role="img"
        aria-label={label}
        className="h-full w-full"
      >
        <rect width="64" height="64" rx="19" fill="#0B1710" />
        <path
          d="M45.5 19.5c-4.6-5.1-15.4-6-21.3-1.9-5.5 3.8-4.6 10.5 1.3 13.1 4.7 2 10.9 1.2 15.1 4.2 4.8 3.4 3.2 9.7-1.6 12.4-6 3.4-15.4 1.6-19.4-3.4"
          fill="none"
          stroke="#F4FBF6"
          strokeWidth="6.5"
          strokeLinecap="round"
        />
        <circle cx="46.5" cy="18" r="5" fill="#67EE98" />
        <path d="M47 8.5c0-3.3 2.6-5.7 6.2-5.7-.7 3.5-2.8 5.6-6.2 5.7Z" fill="#C9FFD9" />
      </svg>
    </span>
  );
}
