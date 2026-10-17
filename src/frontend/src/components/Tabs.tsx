interface TabsProps<T extends string> {
  tabs: { id: T; label: string }[]
  active: T
  onSelect: (id: T) => void
}

// The underline tab bar at the top of each view (styles: .mp-tabs in index.css).
export function Tabs<T extends string>({ tabs, active, onSelect }: TabsProps<T>) {
  return (
    <div role="tablist" className="mp-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onSelect(tab.id)}
          className="mp-tab"
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
