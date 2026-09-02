import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("BoSketchObs failed to render", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "100vh", padding: 32, color: "#f1f4f6", background: "#151a1f", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>
        <h1 style={{ marginTop: 0 }}>BoSketchObs could not open this board</h1>
        <p>The app is still running, but the board failed to render. Reload the window to try again.</p>
        <pre style={{ whiteSpace: "pre-wrap", color: "#ff9b9b" }}>{this.state.error.message}</pre>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer" }}>Reload</button>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>,
);
