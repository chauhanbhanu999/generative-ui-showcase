"""Structure-aware chunking on top of a Docling-parsed document.

Splitting the flattened markdown of a mixed-layout PDF with a single text
splitter breaks down fast: a merged-cell table gets cut mid-row, a chart's
caption drifts into an unrelated chunk. Instead this walks the document in
Docling's reading order and branches by element type:

- tables and pictures are emitted as single atomic chunks, rendered through
  Docling's own structure-aware exporters so merged cells and captions stay
  intact;
- running prose is buffered per section and only that buffer is handed to
  LangChain's SemanticChunker, so semantic splitting only ever operates on
  actual paragraphs, never on table/figure markup.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from docling_core.types.doc import (
    DoclingDocument,
    DocItemLabel,
    PictureItem,
    SectionHeaderItem,
    TableItem,
    TextItem,
)
from langchain_experimental.text_splitter import SemanticChunker
from langchain_openai import OpenAIEmbeddings

ChunkKind = Literal["text", "table", "picture"]

# Running headers/footers repeat on every page and captions are already folded
# into their table/picture chunk below, so none of them belong in the prose stream.
_SKIP_TEXT_LABELS = {DocItemLabel.PAGE_HEADER, DocItemLabel.PAGE_FOOTER, DocItemLabel.CAPTION}


@dataclass
class Chunk:
    chunk_id: str
    kind: ChunkKind
    content: str
    section: str | None
    page_no: int | None
    metadata: dict = field(default_factory=dict)


def _page_no(item) -> int | None:
    return item.prov[0].page_no if item.prov else None


def _build_semantic_chunker() -> SemanticChunker:
    embeddings = OpenAIEmbeddings(model=os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small"))
    return SemanticChunker(embeddings, breakpoint_threshold_type="percentile")


def chunk_document(document: DoclingDocument, image_dir: str | Path) -> list[Chunk]:
    image_dir = Path(image_dir)
    chunker = _build_semantic_chunker()

    chunks: list[Chunk] = []
    current_section: str | None = None
    text_buffer: list[str] = []
    buffer_page: int | None = None

    def flush_text_buffer() -> None:
        nonlocal text_buffer, buffer_page
        if not text_buffer:
            return
        merged = "\n\n".join(text_buffer)
        for piece in chunker.split_text(merged):
            chunks.append(
                Chunk(
                    chunk_id=f"chunk-{len(chunks):04d}",
                    kind="text",
                    content=piece,
                    section=current_section,
                    page_no=buffer_page,
                    metadata={},
                )
            )
        text_buffer = []
        buffer_page = None

    picture_index = 0
    for item, _level in document.iterate_items():
        if isinstance(item, SectionHeaderItem):
            flush_text_buffer()
            current_section = item.text

        elif isinstance(item, TableItem):
            flush_text_buffer()
            chunks.append(
                Chunk(
                    chunk_id=f"chunk-{len(chunks):04d}",
                    kind="table",
                    content=item.export_to_markdown(document),
                    section=current_section,
                    page_no=_page_no(item),
                    metadata={"caption": item.caption_text(document) or None},
                )
            )

        elif isinstance(item, PictureItem):
            flush_text_buffer()
            picture_index += 1
            caption = item.caption_text(document) or None
            image_path = None
            image = item.get_image(document)
            if image is not None:
                image_dir.mkdir(parents=True, exist_ok=True)
                image_path = image_dir / f"picture-{picture_index:03d}.png"
                image.save(image_path)
            chunks.append(
                Chunk(
                    chunk_id=f"chunk-{len(chunks):04d}",
                    kind="picture",
                    content=caption or "[image]",
                    section=current_section,
                    page_no=_page_no(item),
                    metadata={"image_path": str(image_path) if image_path else None},
                )
            )

        elif isinstance(item, TextItem):
            if item.label in _SKIP_TEXT_LABELS:
                continue
            if buffer_page is None:
                buffer_page = _page_no(item)
            text_buffer.append(item.text)

    flush_text_buffer()
    return chunks
