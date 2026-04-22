import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { useOsStore } from '../store';
import { PtyCanvas } from './PtyCanvas';
import { ThreeViewer } from './ThreeViewer';
import { PdfViewer } from './PdfViewer';
import { BlobTrait } from '../models';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/yaml' ||
    mime === 'application/x-yaml' ||
    mime === 'application/toml' ||
    mime === 'application/x-prolog'
  );
}

function langExtension(mime: string, format: 'yaml' | 'json') {
  if (mime === 'application/json') return json();
  if (mime === 'application/yaml' || mime === 'application/x-yaml' || mime === 'application/toml') return yaml();
  if (mime === 'text/markdown') return markdown();
  if (mime === 'text/x-python') return python();
  if (mime === 'text/x-rust') return rust();
  if (mime === 'text/x-c' || mime === 'text/x-c++' || mime === 'text/x-csharp') return cpp();
  if (mime === 'text/javascript' || mime === 'text/javascript-jsx') return javascript({ jsx: mime.endsWith('-jsx') });
  if (mime === 'text/typescript' || mime === 'text/typescript-tsx') return javascript({ typescript: true, jsx: mime.endsWith('-tsx') });
  if (mime === 'text/html') return html();
  if (mime === 'text/css' || mime === 'text/x-scss') return css();
  if (mime === 'text/x-tex') return StreamLanguage.define(stex);
  // entity doc fallback
  if (format === 'json') return json();
  return yaml();
}

function buildTheme() {
  const s = getComputedStyle(document.documentElement);
  const g = (v: string) => s.getPropertyValue(v).trim();
  return EditorView.theme({
    '&': {
      background: 'transparent',
      color: g('--text-primary') || '#cdd6f4',
      height: '100%',
      fontSize: '13px',
      fontFamily: 'monospace',
    },
    '.cm-content': { caretColor: g('--accent') || '#f5c2e7' },
    '.cm-cursor': { borderLeftColor: g('--accent') || '#f5c2e7' },
    '.cm-gutters': {
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      color: 'var(--text-hint)',
    },
    '.cm-activeLine': { background: 'var(--bg-panel)' },
    '.cm-activeLineGutter': { background: 'var(--bg-secondary)' },
    '.cm-selectionBackground, ::selection': { background: 'var(--bg-panel)' },
  });
}

// ── CodeMirror editor ─────────────────────────────────────────────────────────

interface CMEditorProps {
  initialContent: string;
  mime: string;
  format: 'yaml' | 'json';
  onChange: (val: string) => void;
}

function CMEditor({ initialContent, mime, format, onChange }: CMEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef      = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of(update => {
      if (update.docChanged) onChange(update.state.doc.toString());
    });

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        history(),
        lineNumbers(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        langExtension(mime, format),
        buildTheme(),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [mime, format]); // initialContent is the seed only — editor manages its own state after mount

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'auto' }}
    />
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export const EditionPanel = memo(function EditionPanel() {
  const selectedEntityId = useOsStore(s => s.selectedEntityId);
  const editionEntityId  = useOsStore(s => s.editionEntityId);
  const editionDocKey    = useOsStore(s => s.editionDocKey);
  const editionMode      = useOsStore(s => s.editionMode);
  const editionFormat    = useOsStore(s => s.editionFormat);
  const blobTraits       = useOsStore(s => s.blobTraits);
  const entities         = useOsStore(s => s.allEntities);
  const setEditionEntity = useOsStore(s => s.setEditionEntity);
  const setEditionDoc    = useOsStore(s => s.setEditionDoc);
  const readBlobContent  = useOsStore(s => s.readBlobContent);
  const writeBlobContentById = useOsStore(s => s.writeBlobContentById);
  const getEntityText    = useOsStore(s => s.getEntityText);
  const applyEntityText  = useOsStore(s => s.applyEntityText);

  // Fix 1: follow entity selection from Entities & Relationships panel
  useEffect(() => {
    if (selectedEntityId && selectedEntityId !== editionEntityId) {
      setEditionEntity(selectedEntityId);
    }
  }, [selectedEntityId]);

  const [content, setContent]       = useState<string | null>(null);
  const [editedContent, setEdited]  = useState<string>('');
  const [dirty, setDirty]           = useState(false);
  const [loading, setLoading]       = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [saveOk, setSaveOk]         = useState(false);

  const entity  = entities.find(e => e.id === editionEntityId) ?? null;
  const blobTrait: BlobTrait | null = editionDocKey && editionDocKey !== 'entity'
    ? (blobTraits.find(t => t.id === editionDocKey) ?? null)
    : null;

  const docMime   = blobTrait ? blobTrait.mime : 'application/yaml';
  const isBinary  = blobTrait ? !isTextMime(blobTrait.mime) : false;
  const blobSrc   = blobTrait?.localUrl ? convertFileSrc(blobTrait.localUrl) : null;
  const isImage   = isBinary && !!blobTrait?.mime.startsWith('image/');
  const isPdf     = isBinary && blobTrait?.mime === 'application/pdf';
  const isCad     = isBinary && (blobTrait?.mime === 'model/gltf-binary' || blobTrait?.mime === 'model/gltf+json');

  // Load document content whenever entity/doc/format changes (text blobs only)
  useEffect(() => {
    if (!editionEntityId || !editionDocKey) { setContent(null); return; }
    if (isBinary) { setContent(null); setLoading(false); return; }

    setContent(null);
    setEdited('');
    setLoading(true);
    setDirty(false);
    setSaveError(null);
    setSaveOk(false);

    const load = async () => {
      try {
        let text: string;
        if (editionDocKey === 'entity') {
          text = await getEntityText(editionEntityId, editionFormat);
        } else {
          text = await readBlobContent(editionDocKey);
        }
        setContent(text);
        setEdited(text);
      } catch (e) {
        setContent(`# Error loading document\n${e}`);
        setEdited('');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [editionEntityId, editionDocKey, editionFormat, isBinary]);

  const handleChange = useCallback((val: string) => {
    setEdited(val);
    setDirty(true);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editionEntityId || !editionDocKey || !dirty) return;
    try {
      if (editionDocKey === 'entity') {
        await applyEntityText(editionEntityId, editedContent, editionFormat);
      } else {
        await writeBlobContentById(editionDocKey, editedContent);
      }
      setDirty(false);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (e) {
      setSaveError(String(e));
    }
  }, [editionEntityId, editionDocKey, editionFormat, editedContent, dirty]);

  const handleDiscard = useCallback(() => {
    if (content !== null) { setEdited(content); setDirty(false); }
  }, [content]);

  // Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // Document navigation: Alt+[ / Alt+]
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key !== '[' && e.key !== ']') return;
      if (!editionEntityId) return;
      e.preventDefault();

      const docKeys = buildDocKeyList(editionEntityId, blobTraits);
      if (docKeys.length === 0) return;
      const cur = editionDocKey ?? docKeys[0];
      const idx = docKeys.indexOf(cur);
      const next = e.key === ']'
        ? docKeys[(idx + 1) % docKeys.length]
        : docKeys[(idx - 1 + docKeys.length) % docKeys.length];
      setEditionDoc(next);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editionEntityId, editionDocKey, blobTraits, setEditionDoc]);

  // Terminal mode: fire backend command to open $EDITOR in embedded PTY
  const terminalSessionId = editionDocKey === 'entity'
    ? `edit-${editionEntityId ?? ''}`
    : `edit-blob-${(editionDocKey ?? '').replace(/:/g, '-')}`;

  useEffect(() => {
    if (editionMode !== 'terminal' || !editionEntityId || !editionDocKey) return;
    if (editionDocKey === 'entity') {
      invoke('edit_entity_in_terminal', { entityId: editionEntityId, format: editionFormat }).catch(() => {});
    } else {
      invoke('edit_blob_in_terminal', { blobTraitId: editionDocKey }).catch(() => {});
    }
  }, [editionMode, editionEntityId, editionDocKey, editionFormat]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!editionEntityId) {
    return (
      <div className="edition-panel edition-panel-empty">
        <span>Select an entity in the Entities &amp; Relationships panel to start editing.</span>
      </div>
    );
  }

  if (!editionDocKey) {
    return (
      <div className="edition-panel edition-panel-empty">
        <span>Select a document in the side panel.</span>
      </div>
    );
  }

  if (editionMode === 'terminal') {
    return (
      <div className="edition-panel edition-panel-terminal">
        <PtyCanvas sessionId={terminalSessionId} skipAutoSpawn />
      </div>
    );
  }

  // Binary blob: preview mode
  if (isBinary && blobTrait) {
    const openExternal = async () => {
      if (!blobTrait.localUrl) return;
      try { await invoke('open_external_path', { path: blobTrait.localUrl }); }
      catch (err) { console.error('External open failed', err); }
    };
    return (
      <div className="edition-panel">
        <div className="edition-canvas" style={{ padding: isImage ? 16 : 0 }}>
          {isImage && blobSrc ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <img src={blobSrc} alt={blobTrait.filename}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
            </div>
          ) : isPdf && blobSrc ? (
            <PdfViewer url={blobSrc} />
          ) : isCad && blobSrc ? (
            <ThreeViewer url={blobSrc} />
          ) : (
            <div className="edition-panel-empty">
              <span>{blobTrait.mime} · {blobTrait.filename}</span>
            </div>
          )}
        </div>
        <div className="edition-footer">
          <div className="edition-footer-actions">
            {blobTrait.localUrl && (
              <button className="edition-btn" onClick={openExternal}>Open Externally</button>
            )}
          </div>
          <div className="edition-footer-status">
            <span>{entity?.label ?? editionEntityId} · {blobTrait.filename}</span>
          </div>
        </div>
      </div>
    );
  }

  // Web mode: CodeMirror
  return (
    <div className="edition-panel">
      <div className="edition-canvas">
        {loading ? (
          <div className="edition-panel-empty"><span>Loading…</span></div>
        ) : content !== null ? (
          <CMEditor
            key={`${editionEntityId}-${editionDocKey}-${editionFormat}`}
            initialContent={editedContent}
            mime={docMime}
            format={editionFormat}
            onChange={handleChange}
          />
        ) : null}
      </div>
      <div className="edition-footer">
        <div className="edition-footer-actions">
          <button
            className="edition-btn edition-btn-primary"
            disabled={!dirty}
            onClick={handleSave}
          >
            Save
          </button>
          <button
            className="edition-btn"
            disabled={!dirty}
            onClick={handleDiscard}
          >
            Discard
          </button>
        </div>
        <div className="edition-footer-status">
          {saveError && <span className="edition-status-error">{saveError}</span>}
          {saveOk && <span className="edition-status-ok">Saved</span>}
          {!saveError && !saveOk && (
            <span>
              {entity?.label ?? editionEntityId}
              {' · '}
              {editionDocKey === 'entity' ? `entity` : (blobTrait?.filename ?? editionDocKey)}
              {dirty ? ' · modified' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

// ── Utils ─────────────────────────────────────────────────────────────────────

function buildDocKeyList(entityId: string, blobTraits: BlobTrait[]): string[] {
  const own     = blobTraits.filter(t => t.owner === entityId);
  const notes   = own.filter(t => t.mime === 'text/markdown');
  const texts   = own.filter(t => t.mime !== 'text/markdown' && isTextMime(t.mime));
  const binaries = own.filter(t => !isTextMime(t.mime));
  return [
    'entity',
    ...notes.map(t => t.id),
    ...texts.map(t => t.id),
    ...binaries.map(t => t.id),
  ];
}
