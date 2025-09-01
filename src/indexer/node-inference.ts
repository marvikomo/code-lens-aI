import { LLMService } from '../langchain'
import { z } from 'zod'
import { GraphUtil } from '../util/graph-utils'
import { Graph } from 'graphlib'
import { ParallelBatchProcessor } from '../batcher/batch-processor'

const NodeInferenceSchema = z.object({
  nodeAnalyses: z.array(
    z.object({
      nodeId: z.string(),
      purpose: z.string().describe('What this node does and its role'),
      importance: z
        .enum(['critical', 'high', 'medium', 'low'])
        .describe('Importance level'),
      relationships: z.string().describe('Key relationships and dependencies'),
      codeInsights: z
        .string()
        .describe('Code patterns and architectural insights'),
      businessValue: z
        .string()
        .describe('Business or functional value this node provides'),
    }),
  ),
})

interface SelectedNodeGroup {
  selectedNodes: string[]
  reasons: Record<string, string>
  moduleId: string
  filePath: string
}

export class NodeInference {
  private llmService: LLMService
  private graphUtil: GraphUtil

  constructor(graph: Graph, llmService: LLMService) {
    this.llmService = llmService
    this.graphUtil = new GraphUtil(graph)
  }

  async processSelectedNodes(
    selectedGroups: SelectedNodeGroup[],
    projectContext: string,
  ): Promise<void> {
    console.log(`Starting inference for ${selectedGroups.length} module groups`)

    const result = await ParallelBatchProcessor.processInChunks(
      selectedGroups,
      3, // Process 2 module groups at a time
      async (batch: SelectedNodeGroup[]) => {
        const results = []
        for (const group of batch) {
          const result = await this.processNodeGroup(group, projectContext)
          results.push(result)
        }
        return results
      },
      {
        concurrency: 2,
        stopOnError: false,
        onProgress: (completed, total) => {
          console.log(
            `Inference progress: ${completed}/${total} batches completed`,
          )
        },
      },
    )

    // const totalProcessed = result.results
    //   .flat()
    //   .reduce((sum, group) => sum + group.processedCount, 0)
    console.log(
      `Node inference complete. Processed`,
    )
  }

  private async processNodeGroup(
    group: SelectedNodeGroup,
    projectContext,
  ): Promise<{ processedCount: number }> {
    try {
      console.log(
        `Processing ${group.selectedNodes.length} selected nodes from ${group.filePath}`,
      )

      if (group.selectedNodes.length === 0) {
        return { processedCount: 0 }
      }

      // Build detailed context for selected nodes
      const nodesContext = this.graphUtil.buildDetailedNodesContext(
        group.selectedNodes,
      )

      // Include selection reasons as context
      // const selectionContext = this.graphUtil.buildDetailedNodesContext(group)

      // Check token limits
      const baseContext = projectContext
      const maxTokensForNodes =
        2500 - this.llmService.estimateTokens(baseContext)
      //const finalNodesContext = truncateToTokenLimit(nodesContext, maxTokensForNodes)

     await this.llmService.runInferenceOnSelectedNodes(
        projectContext,
        group.filePath,
        nodesContext,
      )
    } catch (error) {
      console.error(`Error processing inference for ${group.filePath}:`, error)
      return { processedCount: 0 }
    }
  }
}
