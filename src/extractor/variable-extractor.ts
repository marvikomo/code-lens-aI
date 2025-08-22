import Parser from 'tree-sitter'
import { Extractor } from './extractor'
import { Neo4jClient } from '../db/neo4j-client'
import { DbSchema } from '../db/schema'
import { logger } from '../logger'
import { FunctionNodeService } from '../services/function-node-service'
import { NodeType } from '../enum/NodeType'
import { TreeSitterUtil } from '../util/tree-sitter-util'
import { ClassNodeService } from '../services/class-node-service'
import { CodeVectorStore } from '../vector-store'
import { Graph } from 'graphlib';
export class VariableExtractor extends Extractor {
  private functionNodeService: FunctionNodeService
  private classNodeService: ClassNodeService
   constructor(treeSitterUtil: TreeSitterUtil, vectorStore: CodeVectorStore, graph: Graph) {
    super( treeSitterUtil, vectorStore, graph)
  
  }

  /**
   * Extract variables from a parsed file and store in Neo4j
   */
  async extract(
    tree: Parser.Tree,
    content: string,
    filePath: string,
    query: Parser.Query,
  ): Promise<void> {
    // Ensure module node exists
   
  }



}
