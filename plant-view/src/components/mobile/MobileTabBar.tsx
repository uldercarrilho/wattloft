export type MobileTab = "glance" | "power" | "history" | "insights";

export const MOBILE_TABS: { id: MobileTab; label: string; icon: string }[] = [
  { id: "glance", label: "Glance", icon: "☼" },
  { id: "power", label: "Power", icon: "📈" },
  { id: "history", label: "History", icon: "📅" },
  { id: "insights", label: "Insights", icon: "⚡" },
];

export function MobileTabBar({
  activeTab,
  onSelectTab,
}: {
  activeTab: MobileTab;
  onSelectTab: (tab: MobileTab) => void;
}) {
  return (
    <nav className="mobile-tab-bar" role="tablist" aria-label="Mobile views">
      {MOBILE_TABS.map((tab) => {
        const selected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-controls={`tabpanel-${tab.id}`}
            aria-selected={selected}
            className={`mobile-tab-item${selected ? " is-active" : ""}`}
            onClick={() => onSelectTab(tab.id)}
          >
            <span className="mobile-tab-icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span className="mobile-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
