import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label ?? 'panel'}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel" style={{ alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div className="placeholder-icon">⚠️</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            {this.props.label ?? 'Panel'} crashed
          </p>
          <pre style={{
            fontSize: 10,
            color: '#ff6b6b',
            maxWidth: 320,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'left',
            padding: '6px 10px',
            background: 'rgba(255,107,107,0.06)',
            borderRadius: 4,
          }}>
            {this.state.error.message}
          </pre>
          <button
            className="dialog-submit"
            style={{ marginTop: 8 }}
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
