import type { ComponentType } from "react";

import { CaseDossier } from "@/components/case-dossier";
import { AmSearchResults } from "@/components/am-search-results";
import { FundingTable } from "@/components/funding-table";
import { DownloadButton } from "@/components/download-button";

// Keys here must exactly match COMPONENT_BY_INTENT in backend/agent_graph.py -
// that dict is the single source of truth for which identifier strings
// are valid; this registry is just the client-side half of the dispatch.
export const COMPONENT_REGISTRY: Record<string, ComponentType<any>> = {
  "case-dossier": CaseDossier,
  "am-search-results": AmSearchResults,
  "funding-table": FundingTable,
  "download-button": DownloadButton,
};
