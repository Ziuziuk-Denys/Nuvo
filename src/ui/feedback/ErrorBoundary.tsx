import { Component, type ErrorInfo, type ReactNode } from "react";
import { logError } from "../ports/feedback";
import { ErrorScreen } from "./ErrorScreen";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Tests pass a spy; the app reloads the window. */
  onReload?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

/** The last line of defence: a render error anywhere below swaps the window for the error screen. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    logError(error, info);
  }

  override render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return <ErrorScreen error={error} componentStack={info?.componentStack ?? null} onReload={this.props.onReload ?? (() => window.location.reload())} />;
  }
}
