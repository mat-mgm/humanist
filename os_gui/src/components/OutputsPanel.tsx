import { ArrowUpFromLine } from 'lucide-react';

export function OutputsPanel() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
        color: 'var(--text-hint)',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <ArrowUpFromLine size={36} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
        Outputs
      </div>
      <div style={{ fontSize: 12, maxWidth: 380, lineHeight: 1.6 }}>
        Use the side panel on the left to choose an export target and destination directory.
        The current target is a canonical Prolog snapshot (<code>.pl + blobs/</code>); future
        targets will register through the same dispatcher.
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 8 }}>
        Tip: a snapshot exported from here can be re-imported through the Inputs panel for a
        deterministic round-trip.
      </div>
    </div>
  );
}
