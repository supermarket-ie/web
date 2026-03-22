export function NutritionPill({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg px-2 py-1.5 min-w-[52px]"
      style={{ background: 'var(--surface-container-low)' }}>
      <span className="text-[10px] font-medium leading-none mb-0.5" style={{ color: 'var(--on-surface-variant)' }}>{label}</span>
      <span className="text-xs font-extrabold leading-none price" style={{ color: 'var(--on-background)' }}>{value}</span>
      <span className="text-[9px] leading-none" style={{ color: 'var(--on-surface-variant)' }}>{unit}</span>
    </div>
  );
}
