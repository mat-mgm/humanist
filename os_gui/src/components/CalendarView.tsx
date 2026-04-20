import { useState } from 'react';
import { useOsStore } from '../store';

const fmtYear = (jsYear: number) => jsYear > 0 ? `${jsYear} CE` : `${1 - jsYear} BCE`;

export function CalendarView() {
  const temporalTraits = useOsStore(s => s.temporalTraits);
  const entities = useOsStore(s => s.entities);
  const setSelectedIds = useOsStore(s => s.setSelectedIds);

  const timelineEvents = temporalTraits
    .map(t => ({ trait: t, entity: entities.find(e => e.id === t.owner) }))
    .filter(e => e.entity);

  const [viewYear, setViewYear]   = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [yearInput, setYearInput] = useState(String(new Date().getFullYear()));

  const applyYear = (y: number) => { setViewYear(y); setYearInput(String(y)); };
  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewMonth(d.getMonth()); applyYear(d.getFullYear());
  };
  const handleYearInput = (v: string) => {
    setYearInput(v);
    const n = parseInt(v, 10);
    if (!isNaN(n)) setViewYear(n);
  };

  const monthEnd = new Date(viewYear, viewMonth + 1, 0);
  const first    = new Date(viewYear, viewMonth, 1);
  first.setDate(first.getDate() - first.getDay());

  const days: Date[] = [];
  let cur = new Date(first);
  while (cur <= monthEnd || cur.getDay() !== 0) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  const navBtn: React.CSSProperties = {
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    borderRadius: 4, padding: '4px 8px', color: 'var(--text-hint)', cursor: 'pointer', fontSize: 11,
  };

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Toolbar */}
      <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)', height: 40, flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Calendar</span>
        <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>{timelineEvents.length} events</span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 16px', overflowY: 'auto' }}>
        {/* Year jumper */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          {[-1000, -100, -10, -1].map(d => (
            <button key={d} onClick={() => applyYear(viewYear + d)} style={navBtn}>{d}y</button>
          ))}
          <input type="text" value={yearInput} onChange={e => handleYearInput(e.target.value)} placeholder="Year"
            style={{ width: 80, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)', fontSize: 12, textAlign: 'center', outline: 'none' }} />
          {[1, 10, 100, 1000].map(d => (
            <button key={d} onClick={() => applyYear(viewYear + d)} style={navBtn}>+{d}y</button>
          ))}
          <button onClick={() => { applyYear(new Date().getFullYear()); setViewMonth(new Date().getMonth()); }}
            style={{ ...navBtn, color: 'var(--accent)', borderColor: 'var(--accent)' }}>Today</button>
        </div>

        {/* Month nav */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <button onClick={() => shiftMonth(-1)} style={navBtn}>‹ Prev</button>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {new Date(viewYear, viewMonth, 1).toLocaleString('default', { month: 'long' })} {fmtYear(viewYear)}
          </span>
          <button onClick={() => shiftMonth(1)} style={navBtn}>Next ›</button>
        </div>

        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', flex: 1, minHeight: 0 }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} style={{ background: 'var(--bg-secondary)', padding: 6, textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-hint)' }}>{d}</div>
          ))}
          {days.map(d => {
            const isToday = d.toDateString() === new Date().toDateString();
            const isCurrentMonth = d.getMonth() === viewMonth;
            const dayEvts = timelineEvents.filter(e => {
              const s = e.trait.event_at || e.trait.starts_at;
              if (!s) return false;
              const sd = new Date(s);
              return sd.getFullYear() === viewYear && sd.getMonth() === viewMonth && sd.getDate() === d.getDate();
            });
            return (
              <div key={d.toISOString()} style={{ background: isCurrentMonth ? 'var(--bg-panel)' : 'var(--bg)', padding: 6, minHeight: 56, opacity: isCurrentMonth ? 1 : 0.4 }}>
                <span style={{ fontSize: 12, fontWeight: isToday ? 800 : 400, color: isToday ? 'var(--accent)' : 'var(--text-primary)' }}>{d.getDate()}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                  {dayEvts.map(e => (
                    <div key={e.trait.id} onClick={() => e.entity && setSelectedIds([e.entity!.id])}
                      style={{ fontSize: 10, background: 'var(--bg-secondary)', padding: '2px 4px', borderRadius: 2, borderLeft: '2px solid var(--accent)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>
                      {e.entity?.label}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
