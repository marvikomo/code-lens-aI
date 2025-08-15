import Parser from 'tree-sitter'
import { Neo4jClient } from '../db/neo4j-client'
import { DbUtils } from '../util/db-utils'
import { TreeSitterUtil } from '../util/tree-sitter-util'
import { CodeVectorStore } from '../vector-store'
import { Graph } from 'graphlib';

export abstract class Extractor {
  protected dbUtils: DbUtils
  constructor(protected dbClient: Neo4jClient, protected treeSitterUtils:TreeSitterUtil, protected vectorStore: CodeVectorStore, protected graph: Graph) {
    this.dbUtils = new DbUtils(dbClient)
  }

  /**
   * Extract entities from a parsed file and store in Neo4j
   */
  abstract extract(
    tree: Parser.Tree,
    content: string,
    filePath: string,
    query: Parser.Query,
    lspClient?: any
  ): Promise<void>

  /**
   * Generate a unique ID for a node within a file
   */
  protected generateNodeId(
    type: string,
    name: string | null,
    filePath: string,
    startRow: number,
    endRow: number,
    startColumn: number = 0,
    endColumn: number = 0,
  ): string {
    // Create an ID that's unique and deterministic
    return `${type}:${filePath}:${name ? name: ""}:${startRow}:${endRow}:${startColumn}:${endColumn}`
  }
  /**
   * Create a module node if it doesn't exist
   */
  protected async ensureModuleNode(filePath: string): Promise<void> {
    return this.dbUtils.ensureModuleNode(filePath);
  }
}
