from __future__ import annotations

import math
import random
from statistics import mean, median

import numpy as np

from .config import settings


def blend_weights(hours_to_settlement: float) -> dict[str, float]:
    if hours_to_settlement <= 4:
        return {"nbmWeight": 0.10, "hrrrWeight": 0.25, "nwsWeight": 0.15, "observationsWeight": 0.50}
    if hours_to_settlement <= 12:
        return {"nbmWeight": 0.25, "hrrrWeight": 0.40, "nwsWeight": 0.20, "observationsWeight": 0.15}
    if hours_to_settlement <= 24:
        return {"nbmWeight": 0.45, "hrrrWeight": 0.35, "nwsWeight": 0.20, "observationsWeight": 0.00}
    return {"nbmWeight": 0.65, "hrrrWeight": 0.20, "nwsWeight": 0.15, "observationsWeight": 0.00}


def simulate_paths(hourly_mean_f: list[float], paths: int | None = None, seed: int = 42) -> list[list[float]]:
    random.seed(seed)
    count = paths or settings.monte_carlo_paths
    out: list[list[float]] = []
    for _ in range(count):
        daily_bias = random.gauss(0, settings.sigma_daily_f)
        residual = random.gauss(0, settings.sigma_hourly_f)
        path: list[float] = []
        for temp in hourly_mean_f:
            innovation = random.gauss(0, settings.sigma_hourly_f)
            residual = settings.ar1_rho * residual + math.sqrt(1 - settings.ar1_rho**2) * innovation
            path.append(temp + daily_bias + residual)
        out.append(path)
    return out


def summarize(values: list[float]) -> dict[str, float]:
    arr = np.array(values)
    return {
        "meanTemperatureF": float(mean(values)),
        "medianTemperatureF": float(median(values)),
        "p10TemperatureF": float(np.percentile(arr, 10)),
        "p25TemperatureF": float(np.percentile(arr, 25)),
        "p75TemperatureF": float(np.percentile(arr, 75)),
        "p90TemperatureF": float(np.percentile(arr, 90)),
    }


def probability_for_threshold(values: list[float], threshold_f: float, direction: str = "above") -> float:
    if direction == "below":
        return sum(1 for value in values if value <= threshold_f) / len(values)
    return sum(1 for value in values if value >= threshold_f) / len(values)


def probability_for_range(
    values: list[float],
    lower_f: float | None,
    upper_f: float | None,
    lower_inclusive: bool = True,
    upper_inclusive: bool = True,
) -> float:
    if not values:
        return 0.0

    wins = 0
    for value in values:
        lower_ok = lower_f is None or (value >= lower_f if lower_inclusive else value > lower_f)
        upper_ok = upper_f is None or (value <= upper_f if upper_inclusive else value < upper_f)
        if lower_ok and upper_ok:
            wins += 1
    return wins / len(values)


def cap_finite_simulation_probability(probability: float, sample_count: int, min_tail_probability: float = 0.001) -> tuple[float, str | None]:
    """Avoid presenting finite Monte Carlo outcomes as literal certainty."""
    if sample_count <= 0:
        return 0.0, "Probability estimate had no simulation samples."
    tail = max(1 / sample_count, min_tail_probability)
    capped = min(1 - tail, max(tail, probability))
    if capped != probability:
        return capped, "Finite Monte Carlo simulation produced an extreme probability; displayed probability was capped below 100%/above 0%."
    return probability, None
