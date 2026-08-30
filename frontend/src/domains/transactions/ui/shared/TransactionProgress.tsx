type TransactionProgressProps = {
  title: string;
  message: string;
  note?: string;
};

export function TransactionProgress({ title, message, note }: TransactionProgressProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="p-4 bg-surface border border-hairline rounded-xl animate-fade-in"
    >
      <div className="flex items-center gap-4">
        <div className="relative w-10 h-10 shrink-0">
          <div className="absolute inset-0 rounded-full border-4 border-orange-200 dark:border-orange-800 opacity-30"></div>
          <div className="absolute inset-0 rounded-full border-4 border-orange-500 border-t-transparent animate-spin"></div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink mb-1">{title}</p>
          <p className="text-xs font-medium text-orange-700 dark:text-orange-300">{message}</p>
        </div>
      </div>
      {note ? (
        <div className="mt-4 pt-4 border-t border-orange-200/50 dark:border-orange-800/50 text-xs font-medium text-primary">
          {note}
        </div>
      ) : null}
    </div>
  );
}
