from __future__ import annotations

from wattloft.solar.calibration import (
    EnvelopeCalibration,
    calibrate_parameters,
    is_clear_sky_day,
    load_calibration,
    run_calibration,
    save_calibration,
)
from wattloft.solar.clearsky import haurwitz_irradiance, ideal_envelope_curve, ideal_power_w
from wattloft.solar.clipping import ClippingPlateau, ClippingSummary, detect_clipping
from wattloft.solar.drift import DriftResult, evaluate_drift
from wattloft.solar.geometry import SolarPosition, solar_position

__all__ = [
    "ClippingPlateau",
    "ClippingSummary",
    "DriftResult",
    "EnvelopeCalibration",
    "SolarPosition",
    "calibrate_parameters",
    "detect_clipping",
    "evaluate_drift",
    "haurwitz_irradiance",
    "ideal_envelope_curve",
    "ideal_power_w",
    "is_clear_sky_day",
    "load_calibration",
    "run_calibration",
    "save_calibration",
    "solar_position",
]
