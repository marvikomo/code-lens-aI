import { OpenAIEmbeddings } from '@langchain/openai'
import { ChatOpenAI } from '@langchain/openai'
import { PromptTemplate } from '@langchain/core/prompts'
import { z } from 'zod'
import { Graph } from 'graphlib'
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

interface DocstringRequest {
  nodeId: string
  text: string
  nodeType: string
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

const DocstringNodeSchema = z.object({
  nodeId: z.string(),
  docstring: z.string(),
  tags: z.array(z.string()),
})

const DocstringResponseSchema = z.object({
  docstrings: z.array(DocstringNodeSchema),
})

type DocstringResponse = z.infer<typeof DocstringResponseSchema>

export class LangChainInferenceService {
  private embeddings: OpenAIEmbeddings
  private llm: ChatOpenAI

  constructor(options?: {
    maxConcurrentBatches?: number
    batchDelay?: number
    maxConcurrentEmbeddings?: number
  }) {
    // Rate limiting configuration

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

  // Generate response using modern withStructuredOutput approach
  async generateResponse(
    batch: DocstringRequest[],
  ): Promise<DocstringResponse> {

    const structuredLLM = this.llm.withStructuredOutput(
      DocstringResponseSchema,
      {
        method: 'json_schema',
      },
    )

    const prompt = PromptTemplate.fromTemplate(`    
        You are a senior software engineer with expertise in code analysis and documentation. Your task is to generate concise docstrings for each code snippet and tag it based on its purpose.    
        
        **Instructions**:    
        1. **Identify Code Type**: Determine whether each code snippet is primarily **backend** or **frontend**.    
        2. **Summarize the Purpose**: Write a brief (1-2 sentences) summary of the code's main purpose and functionality.    
        3. **Assign Tags**: Use these specific tags based on code type:    
        
        **Backend Tags**: AUTH, DATABASE, API, UTILITY, PRODUCER, CONSUMER, EXTERNAL_SERVICE, CONFIGURATION    
        **Frontend Tags**: UI_COMPONENT, FORM_HANDLING, STATE_MANAGEMENT, DATA_BINDING, ROUTING, EVENT_HANDLING, STYLING, MEDIA, ANIMATION, ACCESSIBILITY, DATA_FETCHING    
    
        Here are the code snippets:    
        {code_snippets}    
    `)


      console.log('batch cnt', await this.estimateTokens(JSON.stringify(batch)))
    const codeSnippets = batch
      .map(
        (req) =>
          `ID: ${req.nodeId}\nType: ${req.nodeType}\nCode: ${req.text.substring(
            0,
            500,
          )}`,
      ) // Limit length
      .join('\n---\n')

    try {
      const formattedPrompt = await prompt.format({
        code_snippets: codeSnippets,
      })
      // The structured LLM automatically handles parsing - no need for manual parsing
      const response = await structuredLLM.invoke(formattedPrompt)
      if (response) {
        console.log('Just successfully processed')
      }
      return response
    } catch (error) {
      console.error('LLM request failed:', error)
      return { docstrings: [] }
    }
  }

  private async estimateTokens(text: string): Promise<number> {
    return await this.llm.getNumTokens(text)
  }

 
}
