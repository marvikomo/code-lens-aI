import Parser from 'tree-sitter'
import { Extractor } from './extractor'
import { Neo4jClient } from '../db/neo4j-client'
import { FunctionNodeService } from '../services/function-node-service'

import { logger } from '../logger'
import { TreeSitterUtil } from '../util/tree-sitter-util'

export class FunctionExtractor extends Extractor {
  private functionNodeService: FunctionNodeService
  constructor(dbClient: Neo4jClient, treeSitterUtil: TreeSitterUtil) {
    super(dbClient, treeSitterUtil)
    this.functionNodeService = new FunctionNodeService(dbClient)
  }

  /**
   * Extract functions from a parsed file and store in Neo4j
   */
  async extract(
    tree: Parser.Tree,
    content: string,
    filePath: string,
    query: Parser.Query,
  ): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath)

    // Create function query
    const matches = query.matches(tree.rootNode)

    logger.writeResults(matches, 'matches')

    //Process in batches
    const batchSize = 20
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize)
      await this.processFunctionBatch(batch, content, filePath)
    }

    console.log(`Extracted ${matches.length} functions from ${filePath}`)
  }

  /**
   * Process a batch of function matches
   */
  private async processFunctionBatch(
    matches: Parser.QueryMatch[],
    content: string,
    filePath: string,
  ): Promise<void> {
    const functionIndexes = []

    for (const match of matches) {
      // Get function node and name capture
      const functionCapture = match.captures.find((c) => c.name === 'function')
      const nameCapture = match.captures.find((c) => c.name === 'name')

      if (!functionCapture) continue

      const funcNode = functionCapture.node

      // Get function details
      const funcName = nameCapture ? nameCapture.node.text : '<anonymous>'

      functionIndexes.push({
        functionNode: funcNode,
        funcName,
        filePath,
      })
    }

    await this.functionNodeService.indexFunctionsInBatch(functionIndexes)
  }
}
