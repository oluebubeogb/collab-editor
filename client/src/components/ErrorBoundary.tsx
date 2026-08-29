import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex flex-col items-center justify-center bg-neutral-900 text-neutral-100 p-6 gap-3">
          <h1 className="text-lg font-semibold text-red-400">Something went wrong</h1>
          <pre className="text-xs text-neutral-400 max-w-xl whitespace-pre-wrap bg-neutral-950 p-4 rounded border border-neutral-800">
            {this.state.error.message}
          </pre>
          <button
            className="text-sm bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
