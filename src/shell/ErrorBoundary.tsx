import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defence: if a page throws while drawing, show what happened and a way back instead of an empty window.
 * Work is saved a second after every change, so reloading loses at most the last moment.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("MotionCraft screen error:", error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main role="alert" style={{ padding: 32, maxWidth: 640, margin: "10vh auto", color: "var(--mc-text)", font: "14px/1.5 system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Something went wrong on this screen</h1>
        <p>Your project is saved: changes are written a second after you make them. Reload to carry on.</p>
        <p style={{ opacity: 0.7, wordBreak: "break-word" }}>{this.state.error.message}</p>
        <button className="btn primary" onClick={() => window.location.reload()}>Reload MotionCraft</button>
      </main>
    );
  }
}
