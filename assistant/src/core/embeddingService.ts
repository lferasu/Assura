import { OpenAIEmbeddings } from "@langchain/openai";
import { EMBEDDING_MODEL, OPENAI_API_KEY } from "../config/env.js";

export interface EmbeddingProvider {
  embedText(text: string): Promise<number[]>;
}

export class OpenAIEmbeddingService implements EmbeddingProvider {
  private readonly embeddings: OpenAIEmbeddings;

  constructor(
    private readonly modelName = EMBEDDING_MODEL,
    private readonly apiKey = OPENAI_API_KEY
  ) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for embedding generation.");
    }

    this.embeddings = new OpenAIEmbeddings({
      apiKey,
      model: modelName
    });
  }

  async embedText(text: string): Promise<number[]> {
    const [embedding] = await this.embeddings.embedDocuments([text]);
    return embedding ?? [];
  }
}
