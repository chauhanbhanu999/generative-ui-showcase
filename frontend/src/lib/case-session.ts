export interface CaseInfo {
  id: string;
  name: string;
  status: "Open";
}

export function caseLabel(c: CaseInfo): string {
  return c.name ? `${c.id} · ${c.name}` : c.id;
}
