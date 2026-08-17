import { useState } from "react";
import { z } from "zod";

const ArticleSchema = z.object({
  indexInResults: z.number(),
  title: z.string(),
  source: z.string(),
  theme: z.string(),
  url: z.string(),
  summary: z.string(),
});

export const AmSearchResultsProps = z.object({
  caseName: z.string(),
  caseSummary: z.string(),
  parties: z.array(
    z.object({
      partyName: z.string(),
      role: z.string(),
      articlesFound: z.number(),
      searchQueryUsed: z.string().optional(),
      adverseMediaSummary: z.string().optional(),
      articles: z.array(ArticleSchema),
    }),
  ),
});

type AmSearchResultsProps = z.infer<typeof AmSearchResultsProps>;
type Party = AmSearchResultsProps["parties"][number];

function PartyCard({ party }: { party: Party }) {
  const [open, setOpen] = useState(false);
  const hasAdverse = party.articlesFound > 0;

  return (
    <div className="rounded-[14px] border border-[#e6eaf0] bg-white p-[18px] shadow-[0_4px_14px_rgba(0,0,0,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex w-full items-start gap-3">
          <div>
            <h3 className="m-0 text-xl text-[#1f2937]">{party.partyName}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center rounded-full bg-[#eef6ff] px-2.5 py-[3px] text-xs font-semibold text-[#0b63a8]">
                Role: {party.role}
              </span>
              <span className="m-0 text-sm text-[#6b7280]">Articles Found: {party.articlesFound}</span>
              {hasAdverse && party.articles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  aria-label="Show articles"
                  title="Show articles"
                  className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-[#b8d3e8] bg-white text-[#0079c1] transition-colors hover:bg-[#eef6ff] hover:border-[#0079c1]"
                >
                  <span className={`text-base transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▾</span>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="ml-auto flex min-w-[220px] flex-col items-end gap-2">
          <div
            className={`inline-flex w-full max-w-[250px] items-center justify-center rounded-lg px-2.5 py-1.5 text-center text-[13px] font-semibold ${
              hasAdverse
                ? "border border-[#fecaca] bg-[#ffe8e8] text-[#b42318]"
                : "border border-[#b7e4c7] bg-[#eaf9ef] text-[#147a32]"
            }`}
          >
            {hasAdverse ? "Adverse media content found." : "No adverse media content found."}
          </div>
        </div>
      </div>

      {hasAdverse && open && (
        <div className="mt-4 rounded-lg border-2 border-dashed border-[#2f76d2] bg-[#e9eff8] p-3.5">
          <div className="mb-1.5 flex gap-2.5 text-sm">
            <span className="min-w-[130px] font-medium text-[#6b7280]">Search Query Used:</span>
            <span className="break-words text-[#001928]">{party.searchQueryUsed || "-"}</span>
          </div>
          <div className="mb-1.5 flex gap-2.5 text-sm">
            <span className="min-w-[130px] font-medium text-[#6b7280]">Adverse Media Summary:</span>
            <span className="break-words text-[#001928]">{party.adverseMediaSummary || "-"}</span>
          </div>

          {party.articles.map((article) => (
            <div key={article.indexInResults} className="mb-3 rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] p-[14px_14px_12px] last:mb-0">
              <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
                <div className="text-sm font-semibold text-[#1f2937]">Article No: {article.indexInResults}</div>
              </div>
              <div className="mb-2 flex items-baseline gap-2.5">
                <span className="min-w-[95px] text-sm font-medium text-[#6b7280]">Title:</span>
                <span className="min-w-0 flex-1 text-sm text-[#001928]">{article.title}</span>
              </div>
              <div className="mb-2 flex items-baseline gap-2.5">
                <span className="min-w-[95px] text-sm font-medium text-[#6b7280]">Source:</span>
                <span className="min-w-0 flex-1 text-sm text-[#001928]">{article.source}</span>
              </div>
              <div className="mb-2 flex items-baseline gap-2.5">
                <span className="min-w-[95px] text-sm font-medium text-[#6b7280]">Themes:</span>
                <span className="min-w-0 flex-1 text-sm text-[#001928]">{article.theme}</span>
              </div>
              <div className="mb-2 flex items-baseline gap-2.5">
                <span className="min-w-[95px] text-sm font-medium text-[#6b7280]">Link:</span>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 break-all text-sm text-[#0079c1] underline"
                >
                  {article.url}
                </a>
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="min-w-[95px] text-sm font-medium text-[#6b7280]">Summary:</span>
                <span className="min-w-0 flex-1 text-sm text-[#001928]">{article.summary}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AmSearchResults({ caseName, caseSummary, parties }: AmSearchResultsProps) {
  return (
    <div className="w-full max-w-2xl">
      <div className="mb-4 rounded-[10px] border border-[#e2e8f0] bg-[#f7f9fc] p-[18px_24px_14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <div className="mb-1.5 text-[17px] font-semibold text-[#0079c1]">Case Review</div>
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-baseline gap-2.5 text-sm">
            <span className="min-w-[130px] font-medium text-[#6b7280]">Case Name:</span>
            <span className="break-words text-[#001928]">{caseName}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2.5 text-sm">
            <span className="min-w-[130px] font-medium text-[#6b7280]">Executive Summary:</span>
            <span className="break-words text-[#001928]">{caseSummary}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-[18px]">
        {parties.map((party) => (
          <PartyCard key={party.partyName} party={party} />
        ))}
      </div>
    </div>
  );
}
