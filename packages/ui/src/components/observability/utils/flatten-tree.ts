/**
 * Tree flattening utilities for virtual scrolling
 */

import type { SpanNode } from "../types.js";

export interface FlattenedSpan {
  span: SpanNode;
  level: number;
}

export function flattenTree(
  rootSpans: SpanNode[],
  collapsedIds: Set<string>
): FlattenedSpan[] {
  const result: FlattenedSpan[] = [];

  function traverse(span: SpanNode, level: number) {
    result.push({ span, level });
    if (!collapsedIds.has(span.spanId)) {
      span.children.forEach((child) => traverse(child, level + 1));
    }
  }

  rootSpans.forEach((root) => traverse(root, 0));
  return result;
}

export function getAllDescendantIds(span: SpanNode): string[] {
  const ids: string[] = [span.spanId];

  function traverse(s: SpanNode) {
    s.children.forEach((child) => {
      ids.push(child.spanId);
      traverse(child);
    });
  }

  traverse(span);
  return ids;
}

export function getAllSpanIds(rootSpans: SpanNode[]): string[] {
  const ids: string[] = [];

  function traverse(span: SpanNode) {
    ids.push(span.spanId);
    span.children.forEach((child) => traverse(child));
  }

  rootSpans.forEach((root) => traverse(root));
  return ids;
}
