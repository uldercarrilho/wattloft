from __future__ import annotations

from wattloft.solar.calibration import (
    ArrayParameters,
    EnvelopeCalibration,
    calibrate_array_parameters,
    calibrate_parameters,
    calibration_to_meta,
    is_clear_sky_day,
    load_calibration,
    load_calibration_from_meta,
    run_calibration,
    save_calibration,
)
from wattloft.solar.clearsky import (
    array_ideal_power_w,
    haurwitz_irradiance,
    ideal_envelope_curve,
    ideal_power_w,
    plane_of_array_cos_incidence,
)
from wattloft.solar.clipping import ClippingPlateau, ClippingSummary, detect_clipping
from wattloft.solar.drift import DriftResult, evaluate_drift
from wattloft.solar.geometry import SolarPosition, solar_position

__all__ = [
    "ArrayParameters",
    "ClippingPlateau",
    "ClippingSummary",
    "DriftResult",
    "EnvelopeCalibration",
    "SolarPosition",
    "array_ideal_power_w",
    "calibrate_array_parameters",
    "calibrate_parameters",
    "calibration_to_meta",
    "detect_clipping",
    "evaluate_drift",
    "haurwitz_irradiance",
    "ideal_envelope_curve",
    "ideal_power_w",
    "is_clear_sky_day",
    "load_calibration",
    "load_calibration_from_meta",
    "plane_of_array_cos_incidence",
    "run_calibration",
    "save_calibration",
    "solar_position",
]
