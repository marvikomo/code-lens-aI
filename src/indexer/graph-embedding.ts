import { Graph } from 'graphlib'
import { GraphUtil } from '../util/graph-utils'
import { OpenAIEmbeddings } from '@langchain/openai'
import { ParallelBatchProcessor } from '../batcher/batch-processor'

export interface NodeEmbedding {
  nodeId: string
  nodeType: string
  name: string | null
  embedding: number[]
  contextualText: string
  relationships: {
    incoming: Array<{ fromId: string; fromName: string; type: string }>
    outgoing: Array<{ toId: string; toName: string; type: string }>
  }
  metadata: {
    filePath?: string
    rowStart?: number
    rowEnd?: number
    signature?: string
    code?: string
    [key: string]: any
  }
}

export interface EmbeddingOptions {
  includeRelationships: boolean
  includeCode: boolean
  includeSignature: boolean
  includeContext: boolean
  maxContextLength: number
}

export class GraphEmbedding {
  private graph: Graph
  private graphUtil: GraphUtil
  private embeddings: OpenAIEmbeddings
  //private openai: OpenAI

  constructor(graph: Graph) {
    this.graph = graph
    this.graphUtil = new GraphUtil(graph)
    this.embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-ada-002',
      openAIApiKey: process.env.OPENAI_API_KEY,
      maxConcurrency: 2,
    })
  }

  /**
   * Generate embeddings for all nodes in the graph
   */
  async generateAllEmbeddings(
    options: Partial<EmbeddingOptions> = {},
  ): Promise<void> {
    const defaultOptions: EmbeddingOptions = {
      includeRelationships: true,
      includeCode: true,
      includeSignature: true,
      includeContext: true,
      maxContextLength: 2000,
    }

    const config = { ...defaultOptions, ...options }
    console.log('🚀 Starting embedding generation for all nodes...')

    const nodes = this.graph.nodes()
    console.log(`📊 Found ${nodes.length} nodes to process`)

    if (nodes.length === 0) {
      console.log('No nodes to process')
      return
    }

    // Define the batch processor function
    const processEmbeddingBatch = async (
      nodeBatch: string[],
      batchIndex: number,
    ) => {
      const batchResults = []

      for (const nodeId of nodeBatch) {
        try {
          await this.generateNodeEmbedding(nodeId, config)
          batchResults.push({ nodeId, success: true })
        } catch (error) {
          console.error(
            `❌ Failed to generate embedding for node ${nodeId}:`,
            error,
          )
          batchResults.push({
            nodeId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      return batchResults
    }

    // Process nodes in parallel batches
    const result = await ParallelBatchProcessor.processInChunks(
      nodes,
      10, // Batch size: 10 nodes per batch
      processEmbeddingBatch,
      {
        concurrency: 3, // Process 3 batches simultaneously
        stopOnError: false, // Continue processing even if some batches fail
        onProgress: (completed, total) => {
          const percentage = Math.round((completed / total) * 100)
          console.log(
            `📊 Progress: ${percentage}% (${completed}/${total} batches completed)`,
          )
        },
        onBatchComplete: (batchIndex, batchResults) => {
          const successful = batchResults.filter((r) => r.success).length
          const failed = batchResults.filter((r) => !r.success).length
          console.log(
            `✅ Batch ${
              batchIndex + 1
            } complete: ${successful} success, ${failed} failed`,
          )
        },
        onBatchError: (batchIndex, error, batch) => {
          console.error(
            `❌ Entire batch ${batchIndex + 1} failed:`,
            error.message,
          )
          console.error(`   Affected nodes: ${batch.join(', ')}`)
        },
      },
    )

    const allResults = result.results.flat()
    const successCount = allResults.filter((r) => r.success).length
    const failedCount = allResults.filter((r) => !r.success).length

    console.log(`✅ Parallel embedding generation complete!`)
    console.log(`   📈 Successfully processed: ${successCount} nodes`)
    console.log(`   ❌ Failed: ${failedCount} nodes`)
    console.log(`   ⏱️  Total time: ${result.processingTime}ms`)
    console.log(
      `   🚀 Processed ${result.totalBatches} batches with ${result.errorCount} batch errors`,
    )

    // Optionally, log failed nodes for debugging
    if (failedCount > 0) {
      const failedNodes = allResults.filter((r) => !r.success)
      console.warn(
        `⚠️  Failed nodes:`,
        failedNodes.map((f) => f.nodeId),
      )
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text)
  }

  /**
   * Generate embedding for a specific node
   */
  async generateNodeEmbedding(
    nodeId: string,
    options: EmbeddingOptions,
  ): Promise<void> {
    const nodeData = this.graph.node(nodeId)
    if (!nodeData) {
      console.warn(`Node ${nodeId} not found in graph`)
      return
    }
      let contextText: string
       let embedding: number[]

    if(nodeData.inference) {
        contextText = this.buildInferenceContext(nodeId, nodeData)
        console.log("embedding context", contextText)
        embedding = await this.embeddings.embedQuery(contextText)
    }else {
      contextText = this.buildNodeContext(nodeId, nodeData, options)
      embedding = await this.embeddings.embedQuery(contextText)
    }
    

    // Update node with embedding
    this.graph.setNode(nodeId, {
      ...nodeData,
      embedding: embedding,
      embeddingContext: contextText.substring(0, 500) + '...', // Store preview
    })
  }

  /**
   * Build comprehensive context text for a node
   */
  private buildNodeContext(
    nodeId: string,
    nodeData: any,
    options: EmbeddingOptions,
  ): string {
    const parts: string[] = []

    // 1. Basic node information
    parts.push(`Type: ${nodeData.type}`)
    if (nodeData.name) {
      parts.push(`Name: ${nodeData.name}`)
    }

    // 2. Include signature if available and enabled
    if (options.includeSignature && nodeData.signature) {
      parts.push(`Signature: ${nodeData.signature}`)
    }

    // 3. Include code if available and enabled
    if (options.includeCode && nodeData.code) {
      parts.push(`Code:\n${nodeData.code}`)
    }

    // 4. Include relationships if enabled
    if (options.includeRelationships) {
      const relationships = this.getNodeRelationships(nodeId)
      if (relationships.length > 0) {
        parts.push(`Relationships:\n${relationships.join('\n')}`)
      }
    }

    // 5. Include additional context if enabled
    if (options.includeContext) {
      const context = this.getAdditionalContext(nodeId, nodeData)
      if (context) {
        parts.push(`Context: ${context}`)
      }
    }

    // Join all parts and trim to max length
    const fullContext = parts.join('\n\n')
    return fullContext.length > options.maxContextLength
      ? fullContext.substring(0, options.maxContextLength) + '...'
      : fullContext
  }


  private buildInferenceContext(nodeId: string, nodeData: any, options?: EmbeddingOptions): string {
    console.log("Creating inference context for node", nodeId)
  const inference = nodeData.inference
  const parts = [
    `Type: ${nodeData.type}`,
    `Name: ${nodeData.name || 'unnamed'}`,
    `Purpose: ${inference.purpose}`,
    `Importance: ${inference.importance}`,
    `Business Value: ${inference.businessValue}`,
    `Code Insights: ${inference.codeInsights}`,
    `Relationships: ${inference.relationships}`
  ]

  const fullContext = parts.join('\n\n')

  if(!options?.maxContextLength) {
    return fullContext
  }
  return fullContext.length > options.maxContextLength
    ? fullContext.substring(0, options.maxContextLength) + '...'
    : fullContext
}

  /**
   * Get relationship information for a node
   */
  private getNodeRelationships(nodeId: string): string[] {
    const relationships: string[] = []

    // Outgoing relationships (what this node relates to)
    const outEdges = this.graph.outEdges(nodeId) || []
    for (const edge of outEdges) {
      const targetNode = this.graph.node(edge.w)
      const edgeData = this.graph.edge(edge)

      if (targetNode && edgeData) {
        relationships.push(
          `→ ${edgeData.type}: ${targetNode.name || targetNode.type} (${
            edge.w
          })`,
        )
      }
    }

    // Incoming relationships (what relates to this node)
    const inEdges = this.graph.inEdges(nodeId) || []
    for (const edge of inEdges) {
      const sourceNode = this.graph.node(edge.v)
      const edgeData = this.graph.edge(edge)

      if (sourceNode && edgeData) {
        relationships.push(
          `← ${edgeData.type}: ${sourceNode.name || sourceNode.type} (${
            edge.v
          })`,
        )
      }
    }

    return relationships.slice(0, 10) // Limit to prevent context explosion
  }

  /**
   * Get additional context based on node type
   */
  private getAdditionalContext(nodeId: string, nodeData: any): string {
    const contextParts: string[] = []

    switch (nodeData.type) {
      case 'function':
        // Add function-specific context
        if (nodeData.scopeDefinedIn) {
          contextParts.push(`Scope: ${nodeData.scopeDefinedIn}`)
        }
        if (nodeData.calls) {
          const calls = JSON.parse(nodeData.calls || '[]')
          const callNames = calls
            .slice(0, 5)
            .map((call: any) => call.name)
            .join(', ')
          contextParts.push(`Calls: ${callNames}`)
        }
        break

      case 'class':
        // Add class-specific context
        if (nodeData.methods) {
          const methods = JSON.parse(nodeData.methods || '[]')
          const methodNames = methods
            .slice(0, 5)
            .map((method: any) => method.name)
            .join(', ')
          contextParts.push(`Methods: ${methodNames}`)
        }
        break

      case 'import':
        // Add import-specific context
        contextParts.push(`Module: ${nodeData.moduleDefinedIn}`)
        break

      case 'module':
        // Add module-specific context
        const moduleFunctions = this.graphUtil.getFunctionsFromGraph(
          nodeData.path || '',
        )
        if (moduleFunctions.length > 0) {
          const funcNames = moduleFunctions
            .slice(0, 3)
            .map((f) => f.name)
            .join(', ')
          contextParts.push(`Contains functions: ${funcNames}`)
        }
        break
    }

    return contextParts.join(', ')
  }
}
