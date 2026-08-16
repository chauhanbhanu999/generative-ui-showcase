from __future__ import annotations

import os
from typing import Any

import httpx
from langchain_core.tools import tool

ACCUWEATHER_BASE_URL = "http://dataservice.accuweather.com"


@tool
async def get_weather(location: str) -> dict[str, Any]:
    """Look up current weather conditions for a city or place name via AccuWeather."""
    api_key = os.environ.get("ACCUWEATHER_API_KEY")
    if not api_key:
        return {"error": "ACCUWEATHER_API_KEY is not set"}

    async with httpx.AsyncClient(timeout=10.0) as client:
        location_resp = await client.get(
            f"{ACCUWEATHER_BASE_URL}/locations/v1/cities/search",
            params={"apikey": api_key, "q": location},
        )
        location_resp.raise_for_status()
        matches = location_resp.json()
        if not matches:
            return {"error": f"No location found for '{location}'"}

        match = matches[0]
        location_key = match["Key"]
        resolved_name = f"{match['LocalizedName']}, {match['Country']['LocalizedName']}"

        conditions_resp = await client.get(
            f"{ACCUWEATHER_BASE_URL}/currentconditions/v1/{location_key}",
            params={"apikey": api_key, "details": "true"},
        )
        conditions_resp.raise_for_status()
        conditions = conditions_resp.json()
        if not conditions:
            return {"error": f"No current conditions available for '{location}'"}

    current = conditions[0]
    return {
        "location": resolved_name,
        "condition": current["WeatherText"],
        "temperature_c": current["Temperature"]["Metric"]["Value"],
        "temperature_f": current["Temperature"]["Imperial"]["Value"],
        "humidity": current.get("RelativeHumidity"),
        "wind_speed_kmh": current.get("Wind", {}).get("Speed", {}).get("Metric", {}).get("Value"),
        "icon_number": current.get("WeatherIcon"),
        "observed_at": current.get("LocalObservationDateTime"),
    }
