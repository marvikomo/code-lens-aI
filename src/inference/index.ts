import { OpenAIEmbeddings } from '@langchain/openai'
import { ChatOpenAI } from '@langchain/openai'
import {
  CallNode,
  ClassNode,
  ExportNode,
  FileNode,
  FunctionNode,
  GlobalVariableNode,
  ImportNode,
  ModuleNode,
} from 'graph-nodes'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { validateEnv } from '../config/env'

if (!validateEnv()) {
  console.error("Missing required environment variables. Please check your .env file.");
  process.exit(1);
}

interface InferenceData {
  docstring?: string
  tags?: string[]
  embedding?: number[]
}

export type NodeWithInference = (
  | ModuleNode
  | FunctionNode
  | ClassNode
  | CallNode
  | ImportNode
  | ExportNode
  | GlobalVariableNode
  | FileNode
) &
  InferenceData

export class LangChainInferenceService {
  private embeddings: OpenAIEmbeddings

  constructor() {

    // Initialize LangChain components
    this.embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-ada-002',
      openAIApiKey: process.env.OPENAI_API_KEY,
      maxConcurrency: 2,
    })

    this.llm = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      openAIApiKey: process.env.OPENAI_API_KEY,
      temperature: 0.1,
      maxRetries: 3,
      timeout: 120000,
      maxConcurrency: 10, 
    })

    this.geminiLLm = new ChatGoogleGenerativeAI({
      model: 'gemini-2.0-flash', 
      apiKey: process.env.GOOGLE_API_KEY,
    })
  }

  // Generate embeddings using LangChain with rate limiting
  async generateEmbedding(text: string): Promise<number[]> {
    const embedding = await this.embeddings.embedQuery(text)
    return embedding
  }

 
}
