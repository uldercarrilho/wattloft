import { displayNameOf } from "../grains";
import type { PlantSnapshot } from "../types";

function loggerClass(name: string, names: string[]): string {
  if (name === "Plant") return "series-plant";
  const loggers = names.filter((n) => n !== "Plant");
  return loggers.indexOf(name) % 2 === 0 ? "series-a" : "series-b";
}

export function SeriesToggleChips({
  snapshot,
  names,
  hidden,
  onToggle,
}: {
  snapshot: PlantSnapshot;
  names: string[];
  hidden: ReadonlySet<string>;
  onToggle: (name: string) => void;
}) {
  if (names.length === 0) {
    return null;
  }
  return (
    <div className="series-toggles" role="group" aria-label="Series visibility">
      {names.map((name) => {
        const isHidden = hidden.has(name);
        return (
          <button
            key={name}
            type="button"
            className={`series-toggle ${loggerClass(name, names)}${isHidden ? " is-off" : ""}`}
            data-series={name}
            title={name}
            aria-pressed={isHidden ? "false" : "true"}
            onClick={() => onToggle(name)}
          >
            <i aria-hidden="true" />
            <span>{displayNameOf(snapshot, name)}</span>
          </button>
        );
      })}
    </div>
  );
}
