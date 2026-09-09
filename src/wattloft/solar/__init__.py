from __future__ import annotations

from wattloft.solar.geometry import SolarPosition, solar_position
from wattloft.solar.clearsky import haurwitz_irradiance, ideal_power_w, ideal_envelope_curve
from wattloft.solar.clipping import ClippingPlateau, ClippingSummary, detect_clipping
from wattloft.solar.drift import DriftResult, evaluate_drift

__all__ = [
    "ClippingPlateau",
    "ClippingSummary",
    "DriftResult",
    "SolarPosition",
    "detect_clipping",
    "evaluate_drift",
    "haurwitz_irradiance",
    "ideal_envelope_curve",
    "ideal_power_w",
    "solar_position",
]
