import Parser from 'tree-sitter'
import { Extractor } from './extractor'
import { Neo4jClient } from '../db/neo4j-client'
import { DbSchema } from '../db/schema'
import { TreeSitterUtil } from '../util/tree-sitter-util'
import { ClassNodeService } from '../services/class-node-service'

export class ClassExtractor extends Extractor {
  private classNodeService: ClassNodeService
  constructor(dbClient: Neo4jClient, treeSitterUtil: TreeSitterUtil) {
    super(dbClient, treeSitterUtil)
    this.classNodeService = new ClassNodeService(dbClient)
  }
  /**
   * Extract classes from a parsed file and store in Neo4j
   */
  async extract(
    tree: Parser.Tree,
    content: string,
    filePath: string,
    query: Parser.Query,
  ): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath)

    const matches = query.matches(tree.rootNode)

    // Process in batches
    const batchSize = 20
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize)
      await this.processClassBatch(batch, content, filePath)
    }

    console.log(`Extracted ${matches.length} classes from ${filePath}`)
  }

  /**
   * Process a batch of class matches
   */
  private async processClassBatch(
    matches: Parser.QueryMatch[],
    content: string,
    filePath: string,
  ): Promise<void> {

      const classIndexes = []
      for (const match of matches) {
        // Get class node and name capture
        const classCapture = match.captures.find(
          (c) => c.name === 'class' || c.name === 'class_expr',
        )
        const nameCapture = match.captures.find((c) => c.name === 'name')
        const constructorCapture = match.captures.find(
          (c) => c.name === 'constructor',
        )

        if (!classCapture || !nameCapture) continue

        const classNode = classCapture.node

        // Get class details
        const className = nameCapture.node.text

        classIndexes.push({
          classNode,
          className,
          filePath,
        })

       
      }

      await this.classNodeService.indexClassesInBatch(classIndexes, content)
    
  }

 
}
