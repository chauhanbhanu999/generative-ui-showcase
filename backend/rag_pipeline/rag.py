"""Wires together the RAG pipeline stages (ingestion, chunking, embedding,
vector store, retrieval, generation). Only ingestion and chunking exist so far.
"""

from __future__ import annotations

from pathlib import Path

from .chunking import Chunk, chunk_document
from .ingestion import ingest_pdf


def build_chunks_from_pdf(pdf_path: str | Path, image_dir: str | Path) -> list[Chunk]:
    ingested = ingest_pdf(pdf_path)
    return chunk_document(ingested.document, image_dir)
