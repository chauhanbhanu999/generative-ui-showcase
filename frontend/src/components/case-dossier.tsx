import { z } from "zod";

const NoteSchema = z.object({
  title: z.string(),
  status: z.string(),
  text: z.string(),
});

export const CaseDossierProps = z.object({
  caseId: z.string(),
  caseName: z.string(),
  riskLevel: z.string(),
  kycInformation: z.object({
    confidence: z.string().optional(),
    fields: z.array(z.object({ label: z.string(), value: z.string() })),
    notes: z.array(NoteSchema),
  }),
  amlHistory: z.object({
    confidence: z.string().optional(),
    cases: z.array(
      z.object({
        caseId: z.string(),
        type: z.string(),
        status: z.string(),
        recommendation: z.string(),
      }),
    ),
    notes: z.array(NoteSchema),
  }),
  caseBackground: z.object({
    confidence: z.string().optional(),
    summary: z.string(),
    notes: z.array(NoteSchema),
  }),
});

type CaseDossierProps = z.infer<typeof CaseDossierProps>;
type Note = z.infer<typeof NoteSchema>;

function statusChipClasses(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("critical") || s.includes("high")) {
    return "bg-[#ffe8e8] text-[#b42318] border border-[#fecaca]";
  }
  if (s.includes("watch") || s.includes("warn")) {
    return "bg-[#fff4e8] text-[#b54708] border border-[#fdd9b5]";
  }
  return "bg-[#eaf9ef] text-[#147a32] border border-[#b7e4c7]";
}

function BulletCard({ note }: { note: Note }) {
  return (
    <article className="rounded-[10px] border border-[#e6edf6] bg-white p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-bold text-[#1d3247]">{note.title}</p>
        <span
          className={`inline-flex items-center justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold tracking-[0.02em] ${statusChipClasses(note.status)}`}
        >
          {note.status}
        </span>
      </div>
      <p className="m-0 text-[13px] leading-[1.4] text-[#2f455a]">{note.text}</p>
    </article>
  );
}

function AccordionSection({
  title,
  confidence,
  defaultOpen,
  children,
}: {
  title: string;
  confidence?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="overflow-hidden rounded-[10px] border border-[#dce6f1] bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2.5 border-b border-[#e7edf4] bg-gradient-to-b from-[#f8fbff] to-[#f2f8ff] px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <p className="m-0 whitespace-nowrap text-sm font-bold text-[#0c4f88]">{title}</p>
          {confidence && (
            <span className="whitespace-nowrap text-[11px] text-[#5f7182]">{confidence}</span>
          )}
        </div>
        <span className="text-sm text-[#4e6780] transition-transform duration-200 [details[open]_&]:rotate-180">
          ▼
        </span>
      </summary>
      <div className="grid gap-2.5 bg-white p-2.5">{children}</div>
    </details>
  );
}

export function CaseDossier({ caseId, caseName, riskLevel, kycInformation, amlHistory, caseBackground }: CaseDossierProps) {
  return (
    <div className="w-full max-w-2xl rounded-xl border border-[#d9e2ec] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-[#d9e2ec] bg-gradient-to-b from-[#fafdff] to-[#f1f8fd] px-3.5 py-3">
        <div>
          <h3 className="m-0 text-base font-bold text-[#0079c1]">Case {caseName}</h3>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-[#5f7182]">
            <span>Case ID: {caseId}</span>
          </div>
        </div>
        <span className="whitespace-nowrap rounded-full border border-[#fecaca] bg-[#ffe8e8] px-2.5 py-[3px] text-xs font-bold text-[#b42318]">
          {riskLevel}
        </span>
      </div>

      <div className="grid gap-2.5 p-3">
        <AccordionSection title="KYC Information" confidence={kycInformation.confidence} defaultOpen>
          <div className="grid grid-cols-2 gap-2 rounded-[10px] border border-[#e7edf4] bg-[#fbfdff] p-2">
            {kycInformation.fields.map((field) => (
              <div key={field.label} className="rounded-lg border border-[#e8eef6] bg-white p-[7px_8px]">
                <div className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.04em] text-[#5f7182]">
                  {field.label}
                </div>
                <div className="break-words text-[13px] font-semibold text-[#1e364d]">{field.value}</div>
              </div>
            ))}
          </div>
          {kycInformation.notes.map((note) => (
            <BulletCard key={note.title} note={note} />
          ))}
        </AccordionSection>

        <AccordionSection title="AML History" confidence={amlHistory.confidence}>
          <div className="overflow-auto rounded-[10px] border border-[#e5ebf2] bg-white">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {["Case ID", "Type / Sub-Type", "Status", "Recommendation"].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap border-b border-[#a9d9f8] bg-[#c1e7ff] p-2 text-left font-bold text-[#001928]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {amlHistory.cases.map((c) => (
                  <tr key={c.caseId}>
                    <td className="border-b border-[#eef2f6] p-2 align-top text-[#2f455a] last:border-b-0">{c.caseId}</td>
                    <td className="border-b border-[#eef2f6] p-2 align-top text-[#2f455a] last:border-b-0">{c.type}</td>
                    <td className="border-b border-[#eef2f6] p-2 align-top text-[#2f455a] last:border-b-0">{c.status}</td>
                    <td className="border-b border-[#eef2f6] p-2 align-top text-[#2f455a] last:border-b-0">{c.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {amlHistory.notes.map((note) => (
            <BulletCard key={note.title} note={note} />
          ))}
        </AccordionSection>

        <AccordionSection title="Case Background" confidence={caseBackground.confidence}>
          <div className="rounded-[10px] border border-[#e7edf4] border-l-4 border-l-[#0079c1] bg-[#f7fbff] p-2.5 text-[13px] leading-[1.5] text-[#2f455a]">
            {caseBackground.summary}
          </div>
          {caseBackground.notes.map((note) => (
            <BulletCard key={note.title} note={note} />
          ))}
        </AccordionSection>
      </div>
    </div>
  );
}
