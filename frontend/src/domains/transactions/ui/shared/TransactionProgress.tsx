type TransactionProgressProps = {
  title: string;
  message: string;
  note?: string;
};

export function TransactionProgress({ title, message, note }: TransactionProgressProps) {
  return (
    <div className="p-5 bg-orange-50/50 dark:bg-orange-900/10 rounded-2xl border border-orange-100 dark:border-orange-900/20 animate-fadeIn">
      <div className="flex items-center gap-4">
        <div className="relative w-10 h-10 flex-shrink-0">
          <div className="absolute inset-0 rounded-full border-4 border-orange-200 dark:border-orange-800 opacity-30"></div>
          <div className="absolute inset-0 rounded-full border-4 border-orange-500 border-t-transparent animate-spin"></div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">{title}</p>
          <p className="text-xs font-medium text-orange-700 dark:text-orange-300">{message}</p>
        </div>
      </div>
      {note ? (
        <div className="mt-4 pt-4 border-t border-orange-200/50 dark:border-orange-800/50 text-xs font-medium text-orange-600 dark:text-orange-400">
          {note}
        </div>
      ) : null}
    </div>
  );
}
