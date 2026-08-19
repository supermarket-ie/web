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
        <path d="M23 25c0-6.6 4-11 9-11s9 4.4 9 11" fill="none" stroke="#F4FBF6" strokeWidth="5" strokeLinecap="round" />
        <path d="M16 25h32l-4 25H20l-4-25Z" fill="#F4FBF6" stroke="#F4FBF6" strokeWidth="2" strokeLinejoin="round" />
        <path d="M24 34h16" stroke="#0B1710" strokeWidth="4" strokeLinecap="round" />
        <path d="M24 42h10" stroke="#67EE98" strokeWidth="4" strokeLinecap="round" />
        <path d="m45 11 1.8 4.2L51 17l-4.2 1.8L45 23l-1.8-4.2L39 17l4.2-1.8L45 11Z" fill="#67EE98" />
      </svg>
    </span>
  );
}
