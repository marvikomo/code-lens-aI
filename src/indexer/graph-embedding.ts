import { Graph } from 'graphlib'
import { GraphUtil } from '../util/graph-utils'
import { OpenAIEmbeddings } from '@langchain/openai'

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

    let processed = 0
    for (const nodeId of nodes) {
      try {
        await this.generateNodeEmbedding(nodeId, config)
        processed++

        if (processed % 10 === 0) {
          console.log(`✅ Processed ${processed}/${nodes.length} nodes`)
        }
      } catch (error) {
        console.error(
          `❌ Failed to generate embedding for node ${nodeId}:`,
          error,
        )
      }
    }

    console.log(`✅ Completed embedding generation for ${processed} nodes`)
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

    // Build context text for embedding
    const contextText = this.buildNodeContext(nodeId, nodeData, options)
    console.log(`Context for node ${nodeId}:\n`, contextText)

    // Generate embedding
    const embedding = await this.embeddings.embedQuery(contextText)

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
