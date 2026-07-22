import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Shared';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  // Passing a value that changes with the active screen (e.g. the page key)
  // lets navigating away from a crashed screen clear the error automatically,
  // instead of leaving the user stuck until a full reload.
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// The app has no other error boundary, so an uncaught render error anywhere
// unmounts the whole React tree and leaves a blank white page. This confines
// that failure to the screen that threw, keeping the nav shell usable.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled render error:', error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-12 space-y-4">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-rose-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Something went wrong loading this page</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              {this.state.error.message || 'An unexpected error occurred.'}
            </p>
          </div>
          <Button variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
