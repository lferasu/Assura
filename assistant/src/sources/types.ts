import type { NormalizedMessage } from "../core/message.js";

export type SourceCursor = Record<string, unknown>;

export interface FetchResult {
  messages: NormalizedMessage[];
  nextCursor: SourceCursor;
}

export interface MessageSourceAdapter {
  key(): string;
  fetchNew(cursor: SourceCursor): Promise<FetchResult>;
}
