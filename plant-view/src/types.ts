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
  prev_year_today_energy_kwh?: number | null;
  loggers?: LoggerEnergy[];
};

export type LoggerNow = {
  name: string;
  display_name?: string;
  last_success_at: string;
  power_w: number;
};

export type ClippingPlateau = {
  logger_serial: string;
  start_minute: number;
  end_minute: number;
  start_at: string;
  end_at: string;
  plateau_watts: number;
  estimated_clipped_kwh: number;
};

export type ClippingInfo = {
  clipped: boolean;
  clipped_minutes: number;
  estimated_clipped_kwh: number | null;
  plateaus: ClippingPlateau[];
};

export type DriftInfo = {
  detected: boolean;
  advisory: string | null;
  affected_logger: string | null;
  drift_pct: number | null;
  baseline_ratio?: number | null;
  rolling_ratio?: number | null;
  threshold_pct?: number | null;
};

export type EnvelopeCalibration = {
  calibrated: boolean;
  sunny_days_count: number;
  last_calibrated_at: string | null;
  scale?: number;
  tilt_deg?: number;
  azimuth_offset_deg?: number;
  elevation_cutoff_deg?: number;
  ac_cap_w?: number;
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
  loggers_now?: LoggerNow[];
  ideal_curve?: CurvePoint[];
  logger_ideal_curves?: Record<string, CurvePoint[]>;
  clipping?: ClippingInfo | null;
  drift?: DriftInfo | null;
  envelope_calibration?: EnvelopeCalibration | null;
};

export type EmptyPlant = { empty: true };

export type PlantPayload = EmptyPlant | ({ empty: false; unit: Grain } & PlantSnapshot);
