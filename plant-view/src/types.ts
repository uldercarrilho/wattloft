export type Grain = "time" | "day" | "month" | "year";

export type CurvePoint = {
  at: string;
  watts: number;
  lifetime_kwh?: number;
};

export type CurveSeries = {
  name: string;
  display_name?: string;
  points: CurvePoint[];
};

export type LoggerEnergy = {
  name: string;
  display_name?: string;
  today_energy_kwh: number;
};

export type LocalDayBar = {
  local_day: string;
  today_energy_kwh: number;
  loggers?: LoggerEnergy[];
};

export type PlantSnapshot = {
  selected_day: string;
  history_start?: string;
  today_energy_kwh: number | null;
  current_power_w: number;
  lifetime_energy_kwh: number;
  current_power_at: string;
  local_day_bars: LocalDayBar[];
  curve: CurveSeries[];
};

export type EmptyPlant = { empty: true };

export type PlantPayload = EmptyPlant | ({ empty: false; unit: Grain } & PlantSnapshot);
