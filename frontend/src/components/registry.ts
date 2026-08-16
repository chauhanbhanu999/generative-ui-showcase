import type { ComponentType } from "react";

import { FlightCard } from "@/components/flight-card";
import { PieChart } from "@/components/pie-chart";
import { NameGreeting } from "@/components/name-greeting";

// Keys here must exactly match COMPONENT_BY_INTENT in backend/graph.py -
// that dict is the single source of truth for which identifier strings
// are valid; this registry is just the client-side half of the dispatch.
export const COMPONENT_REGISTRY: Record<string, ComponentType<any>> = {
  "pie-chart": PieChart,
  "flight-card": FlightCard,
  "name-greeting": NameGreeting,
};
