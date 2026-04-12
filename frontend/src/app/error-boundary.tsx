import React from "react";

interface ErrorBoundaryProps {
  fallback?: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Global error boundary.
 *
 * Catches render-time errors in the React tree and displays a fallback UI
 * instead of an empty white page. Domain-level boundaries (TreeErrorBoundary,
 * PersonErrorBoundary) should wrap individual page sections so a single
 * domain crash doesn't tear down the whole app.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex items-center justify-center min-h-[200px] p-8">
          <div className="text-center max-w-md">
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Domain-level error boundary with a minimal inline fallback.
 * Use this to wrap tree/person/transaction sections so one domain
 * crashing doesn't take down the whole page.
 */
export function DomainErrorBoundary({
  domain,
  children,
}: {
  domain: string;
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          Failed to load {domain} section. Please refresh the page.
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
