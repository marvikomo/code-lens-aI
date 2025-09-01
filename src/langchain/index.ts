import { LLMModels } from './model'
import { z } from 'zod'
import * as fs from 'fs'
import { StructuredOutputParser } from 'langchain/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { ParallelBatchProcessor } from '../batcher/batch-processor'
import { GraphUtil } from '../util/graph-utils'
import { Graph } from 'graphlib'

interface NodeGroup {
  nodes: string[]
  moduleId: string
  filePath: string
}

interface SelectedNodeGroup {
  selectedNodes: string[]
  reasons: Record<string, string>
  moduleId: string
  filePath: string
}

const DocFilesSchema = z.object({
  documentationFiles: z
    .array(z.string())
    .describe('Array of file paths that contain documentation'),
})

const ProjectDescriptionSchema = z.object({
  description: z.string().describe('Complete project description'),
})

const NodeSelectionSchema = z.object({
  selectedNodes: z.array(z.object({
    nodeId: z.string(),
    reason: z.string().describe('Why this node is important and how it contributes to the module')
  })).max(10).describe('Top 10 most important nodes to analyze')
})

const NodeInferenceSchema = z.object({
  nodeAnalyses: z.array(z.object({
    nodeId: z.string(),
    purpose: z.string().describe('What this node does and its role'),
    importance: z.enum(['critical', 'high', 'medium', 'low']).describe('Importance level'),
    relationships: z.string().describe('Key relationships and dependencies'),
    codeInsights: z.string().describe('Code patterns and architectural insights'),
    businessValue: z.string().describe('Business or functional value this node provides')
  }))
})



export class LLMService {
  private model: LLMModels
  private graph: Graph
  private graphUtil: GraphUtil

  constructor(_graph: Graph) {
    this.model = new LLMModels()
    this.graph = _graph
    this.graphUtil = new GraphUtil(this.graph)
  }

  async identifyDocFiles(files: string[]) {
    const prompt = PromptTemplate.fromTemplate(`
        Given this list of file paths, identify only the files that contain documentation, README files, or other important files for understanding the codebase context.

        Files:
        {files}

        Do not include source code files, test files, or build artifacts. Focus on documentation, README, guides, and configuration files that help understand the project.
     `)

    const chain = prompt.pipe(
      this.model.gpt.withStructuredOutput(DocFilesSchema),
    )

    const result = await chain.invoke({
      files: files.join('\n'),
    })

    return result
  }

  async getProjectDescription(filePaths: string[]): Promise<string> {
    const summaries = await ParallelBatchProcessor.processInChunks(
      filePaths,
      3, // batch size
      async (batch: string[]) => {
        const content = batch
          .map((file) => {
            try {
              return fs.readFileSync(file, 'utf8').slice(0, 2000)
            } catch {
              return ''
            }
          })
          .join('\n\n')

        const prompt = PromptTemplate.fromTemplate(
          `Summarize these docs: {content}`,
        )
        const chain = prompt.pipe(
          this.model.gpt.withStructuredOutput(
            z.object({
              summary: z.string(),
            }),
          ),
        )

        const result = await chain.invoke({ content })
        return result.summary
      },
    )

    const allSummaries = summaries.results.join('\n\n')

    const prompt = PromptTemplate.fromTemplate(`
      Create a project description from these summaries only focus on important features and no more than 200 characters: {summaries}
    `)

    const chain = prompt.pipe(
      this.model.gpt.withStructuredOutput(ProjectDescriptionSchema),
    )
    const result = await chain.invoke({ summaries: allSummaries })

    return result.description
  }

    async selectTopNodesFromAllModules(docFiles: string[], projectContext): Promise<SelectedNodeGroup[]> {
    console.log('Starting node selection process...')
     console.log("graph", this.graph)
    // Get project context first
    //  const projectContext = await this.getProjectDescription(docFiles)
    //  console.log('Project context obtained', projectContext)

    // Group nodes by module
    const nodeGroups = this.graphUtil.groupNodesByModule()
    //console.log(`Processing ${nodeGroups.length} modules`, nodeGroups)

    // Process groups in batches to select top nodes
    const result = await ParallelBatchProcessor.processInChunks(
      nodeGroups,
      3, // Process 3 modules at a time
      async (batch: NodeGroup[]) => {
        const selectedGroups = []
        for (const group of batch) {
          const selected = await this.selectTopNodesFromGroup(group, projectContext)
          selectedGroups.push(selected)
        }
        return selectedGroups
      },
      {
        concurrency: 2,
        stopOnError: false,
        onProgress: (completed, total) => {
          console.log(`Progress: ${completed}/${total} module batches processed`)
        }
      }
    )

     const allSelectedGroups = result.results.flat()
     console.log(`Node selection complete. Selected nodes from ${allSelectedGroups.length} modules`)

     return allSelectedGroups
  }

   private async selectTopNodesFromGroup(group: NodeGroup, projectContext): Promise<SelectedNodeGroup> {
    console.log(`Selecting top nodes from ${group.filePath} (${group.nodes.length} nodes)`)

    if (group.nodes.length <= 10) {
      // If 10 or fewer nodes, select all
      return {
        selectedNodes: group.nodes,
        reasons: group.nodes.reduce((acc, nodeId) => {
          acc[nodeId] = 'Selected due to small module size'
          return acc
        }, {} as Record<string, string>),
        moduleId: group.moduleId,
        filePath: group.filePath
      }
    }

    // Build signatures-only context
    const signaturesContext = this.graphUtil.buildSignaturesContext(group.nodes)

    const prompt = PromptTemplate.fromTemplate(`
      Project Context:
      {projectContext}
      
      Module: {filePath}
      Node Signatures:
      {signatures}
      
      Select the 10 most important nodes from this module to analyze. Consider:
      - Core functionality and business logic
      - High connectivity (many relationships)
      - Entry points and main interfaces
      - Critical dependencies
      - Architectural significance
      
      Prioritize nodes that would give the best understanding of this module's purpose and structure.
    `)

    const chain = prompt.pipe(this.model.gpt.withStructuredOutput(NodeSelectionSchema))

    try {
      const result = await chain.invoke({
        projectContext: projectContext,
        filePath: group.filePath,
        signatures: signaturesContext
      })

      const reasons = result.selectedNodes.reduce((acc, node) => {
        acc[node.nodeId] = node.reason
        return acc
      }, {} as Record<string, string>)

      console.log(`Selected ${result.selectedNodes.length} nodes from ${group.filePath}`)

      return {
        selectedNodes: result.selectedNodes.map(n => n.nodeId),
        reasons,
        moduleId: group.moduleId,
        filePath: group.filePath
      }

    } catch (error) { 
      console.error(`Error selecting nodes from ${group.filePath}:`, error)
      
      // Fallback: select first 10 nodes
      return {
        selectedNodes: group.nodes.slice(0, 10),
        reasons: group.nodes.slice(0, 10).reduce((acc, nodeId) => {
          acc[nodeId] = 'Selected due to processing error'
          return acc
        }, {} as Record<string, string>),
        moduleId: group.moduleId,
        filePath: group.filePath
      }
    }
  }

  async runInferenceOnSelectedNodes(projectContext, filePath, nodeContext): Promise<void> {

    const prompt = PromptTemplate.fromTemplate(`
      Project Context:
      {projectContext}

      Module: {filePath}
 

      Selected Nodes for Deep Analysis:
      {nodesContext}

      Analyze each selected node in detail. Focus on:
      - The specific purpose and functionality
      - How it fits into the overall architecture
      - Key relationships and data flow
      - Code patterns and design decisions
      - Business or functional value
      - Critical dependencies or coupling

      Provide thorough insights that help understand the codebase architecture and design.
    `)

     const chain = prompt.pipe(this.model.gpt.withStructuredOutput(NodeInferenceSchema))

     try{
      const result = await chain.invoke({
        projectContext: projectContext,
        filePath: filePath,
        nodesContext: nodeContext
      })

       for (const analysis of result.nodeAnalyses) {
        this.graphUtil.updateNodeWithInference(analysis)
      }


       console.log(`Completed inference for ${result.nodeAnalyses.length} nodes in ${filePath}`)

     }catch(error) {
      console.error(`Error processing inference for ${filePath}:`, error)
     }
  }



  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }
  truncateToTokenLimit(text: string, maxTokens: number = 1000): string {
    const maxChars = maxTokens * 4

    if (text.length <= maxChars) {
      return text
    }

    return text.slice(0, maxChars) + '...'
  }
}
