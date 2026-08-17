import { Download } from "lucide-react";
import { z } from "zod";

export const DownloadButtonProps = z.object({
  label: z.string().describe("What is being downloaded, e.g. 'Full report' or 'case narrative'"),
  url: z.string().describe("Link to the file to download"),
});

type DownloadButtonProps = z.infer<typeof DownloadButtonProps>;

export function DownloadButton({ label, url }: DownloadButtonProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 underline underline-offset-2 decoration-blue-600/40 transition-colors hover:text-blue-700 hover:decoration-blue-700 dark:text-blue-400 dark:decoration-blue-400/40 dark:hover:text-blue-300"
    >
      <Download className="h-4 w-4" />
      Download {label}
    </a>
  );
}
