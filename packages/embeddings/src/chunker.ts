/* SPDX-License-Identifier: Apache-2.0 */
import type { Entity } from "@arivie/semantic";
import type { Chunk, Chunker } from "./types.js";

type ChunkSection = Chunk["metadata"]["section"];

function splitDescriptionParagraphs(description: string): string[] {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return [""];
  }
  const parts = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}

function makeChunk(
  entityName: string,
  section: ChunkSection,
  indexWithinSection: number,
  text: string,
  name?: string,
): Chunk {
  return {
    id: `${entityName}/${section}/${indexWithinSection}`,
    text,
    metadata: {
      entity: entityName,
      paragraph_idx: indexWithinSection,
      section,
      ...(name !== undefined ? { name } : {}),
    },
  };
}

function joinTextParts(...parts: Array<string | undefined>): string {
  return parts.filter((part) => part != null && part.length > 0).join("\n");
}

export const ParagraphChunker: Chunker = {
  chunk(entity: Entity): Chunk[] {
    const chunks: Chunk[] = [];

    const descriptionParagraphs = splitDescriptionParagraphs(entity.description);
    for (let i = 0; i < descriptionParagraphs.length; i += 1) {
      chunks.push(
        makeChunk(entity.name, "description", i, descriptionParagraphs[i]!),
      );
    }

    for (let i = 0; i < (entity.measures ?? []).length; i += 1) {
      const measure = entity.measures![i]!;
      chunks.push(
        makeChunk(
          entity.name,
          "measure",
          i,
          joinTextParts(measure.name, measure.description, measure.sql),
          measure.name,
        ),
      );
    }

    for (let i = 0; i < (entity.dimensions ?? []).length; i += 1) {
      const dimension = entity.dimensions![i]!;
      chunks.push(
        makeChunk(
          entity.name,
          "dimension",
          i,
          joinTextParts(dimension.name, dimension.description, dimension.sql),
          dimension.name,
        ),
      );
    }

    for (let i = 0; i < (entity.segments ?? []).length; i += 1) {
      const segment = entity.segments![i]!;
      chunks.push(
        makeChunk(
          entity.name,
          "segment",
          i,
          joinTextParts(segment.name, segment.description, segment.sql),
          segment.name,
        ),
      );
    }

    for (let i = 0; i < (entity.example_queries ?? []).length; i += 1) {
      const example = entity.example_queries![i]!;
      chunks.push(
        makeChunk(
          entity.name,
          "example_query",
          i,
          joinTextParts(example.question, example.sql),
        ),
      );
    }

    for (let i = 0; i < (entity.hints ?? []).length; i += 1) {
      const hint = entity.hints![i]!;
      chunks.push(
        makeChunk(entity.name, "hint", i, hint, `hint-${i}`),
      );
    }

    return chunks;
  },
};
