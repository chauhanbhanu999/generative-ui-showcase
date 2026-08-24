"""PDF ingestion via Docling.

Docling runs layout analysis + TableFormer + a reading-order model, so unlike a
naive text extractor it: keeps sentences in the right order across multi-column
pages, reconstructs merged-cell tables into a proper grid instead of a flat cell
list, and locates figures/charts as their own elements with page coordinates. That
structure is what lets chunking.py treat tables and pictures as atomic units
instead of shredding them.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.types.doc import DoclingDocument


@dataclass
class IngestedDocument:
    source_path: Path
    document: DoclingDocument


def _build_converter() -> DocumentConverter:
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_table_structure = True
    pipeline_options.table_structure_options.mode = TableFormerMode.ACCURATE
    pipeline_options.generate_picture_images = True
    pipeline_options.images_scale = 2.0

    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
    )


def ingest_pdf(pdf_path: str | Path) -> IngestedDocument:
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    result = _build_converter().convert(str(pdf_path))
    return IngestedDocument(source_path=pdf_path, document=result.document)
