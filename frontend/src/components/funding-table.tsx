import { z } from "zod";

export const FundingTableProps = z.object({
  title: z.string().optional(),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      align: z.enum(["left", "right"]).optional(),
    }),
  ),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
});

type FundingTableProps = z.infer<typeof FundingTableProps>;

export function FundingTable({ title, columns, rows }: FundingTableProps) {
  return (
    <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_6px_18px_rgba(0,0,0,0.08)]">
      {title && (
        <div className="border-b border-[#edf1f6] px-4 py-3 text-sm font-bold text-[#0079c1]">{title}</div>
      )}
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`sticky top-0 z-10 whitespace-nowrap border-b border-[#a9d9f8] bg-[#c1e7ff] p-3 font-bold text-[#001928] ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="[&:last-child>td]:border-b-0">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap border-b border-[#eef2f6] p-3 align-top text-[#2f455a] ${
                      col.align === "right" ? "text-right tabular-nums" : "text-left"
                    }`}
                  >
                    {row[col.key] ?? "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
