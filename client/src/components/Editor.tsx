import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import MonacoEditor, { OnMount } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import type { editor as MonacoEditorNS } from 'monaco-editor'
import { getMonacoLanguage } from '../lib/fileTypes'

interface EditorProps {
  path: string
  yText: Y.Text
  awareness: WebsocketProvider['awareness'] | undefined
  wordWrap: 'on' | 'off'
  readonly?: boolean
  /** Optional external undo manager; if omitted we create one bound to MonacoBinding */
  undoManager?: Y.UndoManager | null
}

export interface EditorHandle {
  openFind: () => void
  undo: () => void
  redo: () => void
}

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { path, yText, awareness, wordWrap, readonly = false, undoManager: undoManagerProp },
  ref
) {
  const { theme: appTheme } = useTheme()
  const monacoTheme = appTheme === 'light' ? 'vs' : 'vs-dark'
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null)
  const bindingRef = useRef<MonacoBinding | null>(null)
  const undoManagerRef = useRef<Y.UndoManager | null>(null)

  useImperativeHandle(ref, () => ({
    openFind: () => {
      editorRef.current?.getAction('actions.find')?.run()
    },
    undo: () => {
      undoManagerRef.current?.undo()
    },
    redo: () => {
      undoManagerRef.current?.redo()
    }
  }))

  const handleMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    const model = editorInstance.getModel()
    if (!model || !awareness) return

    const binding = new MonacoBinding(
      yText,
      model,
      new Set([editorInstance]),
      awareness
    )
    bindingRef.current = binding

    // y-monaco applies edits with origin = MonacoBinding instance.
    // Default Y.UndoManager only tracks origin `null`, so we must include the binding.
    const um =
      undoManagerProp ??
      new Y.UndoManager(yText, {
        trackedOrigins: new Set([binding, null as unknown as null]),
        captureTimeout: 500
      })
    // If an external manager was passed, still ensure binding origin is tracked
    if (undoManagerProp) {
      try {
        // Yjs UndoManager stores trackedOrigins as a Set
        ;(undoManagerProp as unknown as { trackedOrigins: Set<unknown> }).trackedOrigins.add(
          binding
        )
      } catch {
        // ignore
      }
    }
    undoManagerRef.current = um

    // Collaborative undo/redo (not Monaco's local stack)
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
      um.undo()
    })
    editorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
      () => {
        um.redo()
      }
    )
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      um.redo()
    })

    if (readonly) {
      editorInstance.updateOptions({ readOnly: true })
    }
  }

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap, readOnly: readonly })
  }, [wordWrap, readonly])

  useEffect(() => {
    // Monaco global theme
    try {
      // @ts-expect-error monaco may be on window after load
      const m = (window as unknown as { monaco?: { editor: { setTheme: (t: string) => void } } }).monaco
      m?.editor?.setTheme(monacoTheme)
    } catch {
      /* ignore */
    }
  }, [monacoTheme])

  useEffect(() => {
    return () => {
      bindingRef.current?.destroy()
      bindingRef.current = null
      // Only destroy undo managers we created ourselves
      if (!undoManagerProp && undoManagerRef.current) {
        undoManagerRef.current.destroy()
      }
      undoManagerRef.current = null
    }
  }, [path, undoManagerProp])

  return (
    <MonacoEditor
      key={path}
      height="100%"
      language={getMonacoLanguage(path)}
      theme={monacoTheme}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        wordWrap,
        readOnly: readonly
      }}
    />
  )
})

export default Editor
