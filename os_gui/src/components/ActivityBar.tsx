import {
  Search, Globe, Terminal,
  Settings,
} from 'lucide-react';
import { useOsStore } from '../store';

export type ActivityId =
  | 'graph' | 'causal' | 'terminal'
  | 'settings';

const PRIMARY_CANVAS_IDS = new Set<ActivityId>(['graph', 'causal', 'terminal']);

interface ActivityItem {
  id: ActivityId;
  icon: React.ReactNode;
  title: string;
  group: 'primary' | 'tool';
}

const ACTIVITIES: ActivityItem[] = [
  { id: 'graph',    icon: <Search  size={18} />, title: 'Knowledge Graph', group: 'primary' },
  { id: 'causal',   icon: <Globe   size={18} />, title: 'Causal Panel',    group: 'primary' },
  { id: 'terminal', icon: <Terminal size={18} />, title: 'Terminal',        group: 'primary' },
];

export function ActivityBar() {
  const activeActivity    = useOsStore(s => s.activeActivity);
  const sidePanelOpen     = useOsStore(s => s.sidePanelOpen);
  const setActiveActivity = useOsStore(s => s.setActiveActivity);
  const toggleSidePanel   = useOsStore(s => s.toggleSidePanel);
  const setSidePanelOpen  = useOsStore(s => s.setSidePanelOpen);

  function handleClick(id: ActivityId) {
    if (id === activeActivity) {
      toggleSidePanel();
    } else {
      setActiveActivity(id);
      setSidePanelOpen(true);
    }
  }

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        {ACTIVITIES.map(item => (
          <button
            key={item.id}
            className={`activity-btn${activeActivity === item.id && sidePanelOpen ? ' active' : ''}`}
            title={item.title}
            onClick={() => handleClick(item.id)}
          >
            {item.icon}
          </button>
        ))}
      </div>

      <div className="activity-bar-bottom">
        <button
          className={`activity-btn${activeActivity === 'settings' && sidePanelOpen ? ' active' : ''}`}
          title="Settings"
          onClick={() => handleClick('settings' as ActivityId)}
        >
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}

export { PRIMARY_CANVAS_IDS };
