import { AlertTriangle } from "lucide-react";
import type React from "react";

type ErrorResult = {
  type: string;
  message: string;
  details: string;
};

type TransactionErrorResultProps = {
  title: string;
  error: ErrorResult;
  typeLabel: string;
  messageLabel: string;
  detailsLabel: string;
  retry?: {
    label: string;
    onClick: () => void;
  };
};

export function TransactionErrorResult({
  title,
  error,
  typeLabel,
  messageLabel,
  detailsLabel,
  retry,
}: TransactionErrorResultProps) {
  return (
    <div className="p-5 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-100 dark:border-red-800 animate-fadeIn">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-800 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-red-900 dark:text-red-100 mb-3">{title}</p>
          <div className="space-y-3">
            <ErrorField label={typeLabel}>
              <code className="block bg-white dark:bg-black/20 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-100 px-3 py-2 rounded-xl font-mono text-xs break-all">
                {error.type}
              </code>
            </ErrorField>
            <ErrorField label={messageLabel}>
              <p className="bg-white dark:bg-black/20 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-100 px-3 py-2 rounded-xl text-xs leading-relaxed">
                {error.message}
              </p>
            </ErrorField>
            {error.details !== error.message ? (
              <ErrorField label={detailsLabel}>
                <p className="bg-white dark:bg-black/20 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-100 px-3 py-2 rounded-xl text-xs leading-relaxed">
                  {error.details}
                </p>
              </ErrorField>
            ) : null}
          </div>

          {retry ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={retry.onClick}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-all shadow-md shadow-red-500/20 active:scale-95"
              >
                {retry.label}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ErrorField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-wider text-red-800 dark:text-red-200 opacity-80">
        {label}
      </span>
      {children}
    </div>
  );
}
