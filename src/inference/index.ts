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


class AsyncSemaphore {
  private permits: number
  private queue: Array<() => void> = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--
        resolve(() => this.release())
      } else {
        this.queue.push(() => {
          this.permits--
          resolve(() => this.release())
        })
      }
    })
  }

  private release(): void {
    this.permits++
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      next()
    }
  }
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
  private geminiLLm: ChatGoogleGenerativeAI
  private maxConcurrentBatches: number
  private batchDelay: number
  private maxConcurrentEmbeddings: number

  constructor(options?: {
    maxConcurrentBatches?: number
    batchDelay?: number
    maxConcurrentEmbeddings?: number
  }) {
    // Rate limiting configuration
    this.maxConcurrentBatches = options?.maxConcurrentBatches ?? 5
    this.batchDelay = options?.batchDelay ?? 1000 
    this.maxConcurrentEmbeddings = options?.maxConcurrentEmbeddings ?? 100

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

  // Batch nodes for processing
  private async batchNodes(
  nodes: NodeWithInference[],
  maxTokens: number = 5000,
): Promise<DocstringRequest[][]> {
  const batches: DocstringRequest[][] = []
  let currentBatch: DocstringRequest[] = []
  let currentTokens = 0

  // Create a lookup dictionary for nodes by their ID
  const nodeDict: Record<string, NodeWithInference> = {}
  nodes.forEach(node => {
    const nodeId = node.id
    nodeDict[nodeId] = node
  })

  // Function to replace referenced text with actual content
  const replaceReferencedText = (text: string, nodeDict: Record<string, NodeWithInference>): string => {

    const pattern = /Code replaced for brevity\. See node_id ([a-f0-9]+)/g
    
    let previousText = null
    let currentText = text

    // Keep replacing until no more replacements are possible
    while (previousText !== currentText) {
      previousText = currentText
      currentText = currentText.replace(pattern, (match, nodeId) => {
        if (nodeDict[nodeId]) {
          const referencedNode = nodeDict[nodeId]
          const referencedText = this.extractNodeText(referencedNode)
          // Split on first newline and return the rest (skip the first line)
          const lines = referencedText.split('\n')
          return lines.length > 1 ? '\n' + lines.slice(1).join('\n') : referencedText
        }
        return match // Return original if node not found
      })
    }

    return currentText
  }

  // Process each node
  for (const node of nodes) {
    const nodeText = this.extractNodeText(node)
    
    if (!nodeText || nodeText.trim().length === 0) {
      console.warn(`Node ${this.generateNodeId(node)} has no text. Skipping...`)
      continue
    }

    // Replace any referenced content with actual content
    const updatedText = replaceReferencedText(nodeText, nodeDict)
    const nodeTokens = await this.estimateTokens(updatedText)

    console.log(`Node ${this.generateNodeId(node)}: ${nodeTokens} tokens`)

    // Skip nodes that exceed the max token limit
    if (nodeTokens > maxTokens) {
      console.warn(
        `Node ${this.generateNodeId(node)} - ${nodeTokens} tokens, has exceeded the max_tokens limit. Skipping...`
      )
      continue
    }

    // Start a new batch if adding this node would exceed the limit
    if (currentTokens + nodeTokens > maxTokens) {
      if (currentBatch.length > 0) { // Only append if there are items
        batches.push(currentBatch)
      }
      currentBatch = []
      currentTokens = 0
    }

    // Add node to current batch
    currentBatch.push({
      nodeId: node.id,
      text: updatedText,
      nodeType: node.type,
    })
    currentTokens += nodeTokens
  }

  // Add the final batch if it has content
  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  // Log batching statistics
  const totalNodes = batches.reduce((sum, batch) => sum + batch.length, 0)
  console.log(`Batched ${totalNodes} nodes into ${batches.length} batches`)
  console.log(`Batch sizes: [${batches.map(batch => batch.length).join(', ')}]`)

  return batches
}

  private extractNodeText(node: NodeWithInference): string {
    switch (node.type) {
      case 'function':
        let functionCalls = []
        try {
          functionCalls = node.calls ? JSON.parse(node.calls) : []
        } catch (error) {
          console.warn('Failed to parse function calls:', error)
          functionCalls = []
        }

        const callsText =
          functionCalls
            .map((call) => `${call.name} (${call.callType})`)
            .join(', ') || 'No calls'

        return `Function: ${node.name}\\nSignature: ${node.signature}\\nClass: ${node.classBelongTo}\\nCalls: ${callsText}\\nCode:\\n${node.code}`
      case 'class':
        let members = []
        try {
          members = node.members ? JSON.parse(node.members) : []
        } catch (error) {
          console.warn('Failed to parse class members:', error)
          members = []
        }

        const membersText =
          members.map((m) => `${m.memberType}: ${m.signature}`).join('\\n') ||
          ''

        return `Class: ${node.name}\\nInheritance: ${
          node.inheritance || 'none'
        }\\nMembers:\\n${membersText}`
      case 'module':
        return `Module: ${node.path}`
      case 'import':
        return `Import: ${node.code}`
      case 'export':
        return `export: ${node.code}`
      case 'calls':
        return `Call: ${node.name}(${node.args}) \n code: ${node.code}`
      case 'file':
        return `File: ${node.name}\nExtension: ${
          node.extension
        }\nContent:\n${node.content?.substring(0, 1000)}...`
      default:
        return `${node.type}: ${JSON.stringify(node)}`
    }
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

  // Process batches with controlled concurrency to avoid rate limits
  private async processWithConcurrency(
  batches: DocstringRequest[][],
): Promise<DocstringResponse['docstrings']> {
  const allDocstrings: DocstringResponse['docstrings'] = []
  const semaphore = new AsyncSemaphore(this.maxConcurrentBatches)
  
  console.log(`Processing ${batches.length} batches with async semaphore (max concurrent: ${this.maxConcurrentBatches})`)
  
  const limitedBatches = batches.slice(0, 1)
  // Create promises for all batches
  const batchPromises = batches.map(async (batch, index) => {
    // Wait for semaphore slot
    const release = await semaphore.acquire()
    const batchId = index + 1
    const startTime = Date.now()
    
    try {
      console.log(`Batch ${batchId} started`)
      const response = await this.generateResponse(batch)
      const duration = Date.now() - startTime
      
      console.log(`✅ Batch ${batchId} completed in ${duration}ms - got ${response.docstrings.length} docstrings`)
      
      return {
        success: true,
        docstrings: response.docstrings,
        batchId,
        duration
      }
    } catch (error) {
      const duration = Date.now() - startTime
      console.log(`❌ Batch ${batchId} failed after ${duration}ms: ${error.message}`)
      
      return {
        success: false,
        docstrings: [],
        batchId,
        duration,
        error: error.message
      }
    } finally {
      release() 
    }
  })
  
  // Wait for all batches to complete
  const results = await Promise.all(batchPromises)
  
  // Collect successful results
  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)
  
  successful.forEach(result => {
    allDocstrings.push(...result.docstrings)
  })
  
  console.log(`🎉 Processing complete! ${successful.length} successful, ${failed.length} failed, ${allDocstrings.length} total docstrings`)
  
  return allDocstrings
}

  // Process embeddings with controlled concurrency
  private async processEmbeddingsWithConcurrency(
    nodes: NodeWithInference[],
    docstrings: DocstringResponse['docstrings'],
  ): Promise<NodeWithInference[]> {
    const updatedNodes: NodeWithInference[] = []

    for (let i = 0; i < nodes.length; i += this.maxConcurrentEmbeddings) {
      const nodeSlice = nodes.slice(i, i + this.maxConcurrentEmbeddings)

      console.log(
        `Processing embeddings ${i + 1}-${Math.min(
          i + this.maxConcurrentEmbeddings,
          nodes.length,
        )}/${nodes.length}`,
      )

      const embeddingPromises = nodeSlice.map(async (node) => {
        const nodeId = node.id
        const docstringData = docstrings.find((d) => d.nodeId === nodeId)
        if (docstringData) {
          try {
            const embedding = await this.generateEmbedding(
              docstringData.docstring,
            )
            return {
              ...node,
              docstring: docstringData.docstring,
              tags: docstringData.tags,
              embedding,
            }
          } catch (error) {
            console.error(
              `Embedding generation failed for node ${nodeId}:`,
              error,
            )
            return node
          }
        }

        return node
      })

      const results = await Promise.all(embeddingPromises)
      updatedNodes.push(...results)

      // Small delay between embedding groups
      if (i + this.maxConcurrentEmbeddings < nodes.length) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    return updatedNodes
  }



  // Main inference method with rate limiting
  async runInference(graph: Graph): Promise<NodeWithInference[]> {
    console.log('Starting inference with rate limiting...')


    const nodes: NodeWithInference[] = []
    const nodeIds = graph.nodes()

    for (const nodeId of nodeIds) {
      const nodeData = graph.node(nodeId)
      if (nodeData) {
        nodes.push({id:nodeId, ...nodeData} as NodeWithInference)
      }
    }
 
    console.log(`Processing ${nodes.length} nodes...`)

    const batches = await this.batchNodes(nodes)
    console.log(`Created ${batches.length} batches for processing`)

    // Process batches with controlled concurrency
    const allDocstrings = await this.processWithConcurrency(batches)
    console.log(`Generated ${allDocstrings.length} docstrings`)

    // Process embeddings with controlled concurrency
    const updatedNodes = await this.processEmbeddingsWithConcurrency(
      nodes,
      allDocstrings,
    )
    console.log('Inference completed')
    console.log('updated nodes', updatedNodes)

    return updatedNodes
  }

  private generateNodeId(node: NodeWithInference): string {

    switch (node.type) {
      case 'function':
        return `${node.moduleDefinedIn}:${node.name}:${node.startLine}:${node.endLine}`
      case 'class':
        return `${node.moduleDefinedIn}:${node.name}:${node.startLine}:${node.endLine}`
      case 'module':
        return `mod:${node.path}`
      case 'file':
        return `${node.filePath}:${node.name}:1:${node.lines}`
      default:
        return `${node.type}:${node.startLine || 0}`
    }
  }


  

  private async estimateTokens(text: string): Promise<number> {
    return await this.llm.getNumTokens(text)
  }

 
}
