import Parser from 'tree-sitter'
import { Extractor } from './extractor'
import { Neo4jClient } from '../db/neo4j-client'
import { FunctionNodeService } from '../services/function-node-service'

import { logger } from '../logger'
import { TreeSitterUtil } from '../util/tree-sitter-util'
import { CodeChunk, CodeVectorStore } from '../vector-store'
import { Graph } from 'graphlib'
import { RelationshipType } from '../enum/RelationshipType'

export class FunctionExtractor extends Extractor {
  constructor(
    dbClient: Neo4jClient,
    treeSitterUtil: TreeSitterUtil,
    vectorStore: CodeVectorStore,
    graph: Graph,
  ) {
    super(dbClient, treeSitterUtil, vectorStore, graph)
  }

  /**
   * Extract functions from a parsed file and store in Neo4j
   */
  async extract(
    tree: Parser.Tree,
    content: string,
    filePath: string,
    query: Parser.Query,
    lspClient: any = null,
  ): Promise<void> {
    //TODO include function docstrings in the extraction
    // Ensure module node exists
    await this.ensureModuleNode(filePath)

    // Create function query
    const matches = query.matches(tree.rootNode)
    const moduleId = `mod:${filePath}`
    // logger.writeResults(matches, 'matches')
    console.log('filepath', filePath)
    const allSymbols = await lspClient.getAllSymbols(filePath)
   // console.log('allSymbols', allSymbols)

    for (const match of matches) {
      // Get function node and name capture
      const functionCapture = match.captures.find((c) => c.name === 'function')
      const nameCapture = match.captures.find((c) => c.name === 'name')

      if (!functionCapture) continue

      //console.log("functionCapture", functionCapture.node.text)

      const funcNode = functionCapture.node
      //console.log("extracting")

      //console.log("fn calls", this.treeSitterUtils.findFunctionCalls(funcNode))
      const scope = this.treeSitterUtils.determineNodeContext(funcNode)
      const nodeType = this.treeSitterUtils.getNodeType(scope.parentNode)
      const signature = this.treeSitterUtils.extractFunctionSignature(funcNode)
      const fnId = this.generateNodeId(
        'function',
        null,
        filePath,
        funcNode.startPosition.row + 1,
        funcNode.endPosition.row + 1,
        funcNode.startPosition.column + 1,
        funcNode.endPosition.column + 1,
      )
      let nodeId = null
      if (nodeType !== 'unknown') {
        nodeId = this.generateNodeId(
          nodeType,
          null,
          filePath,
          scope.parentNode.startPosition.row + 1,
          scope.parentNode.endPosition.row + 1,
          scope.parentNode.startPosition.column + 1,
          scope.parentNode.endPosition.column + 1,
        )
      }

      // console.log("fn ids", fnId)

      // console.log("SCOPE", scope)
      //console.log("FUNC CALLS", fnCalls)

      function getCharacterFromTreeSitterNode(node: Parser.SyntaxNode): number {
        // For function declarations, find the identifier node (function name)
        if (node.type === 'function_declaration') {
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (child && child.type === 'identifier') {
              return child.startPosition.column // This will be the function name position
            }
          }
        }

        // Fallback to node start position
        return node.startPosition.column
      }

      this.graph.setNode(fnId, {
        type: 'function',
        name: nameCapture ? nameCapture.node.text : null,
        moduleDefinedIn: filePath,
        rowStart: functionCapture.node.startPosition.row + 1,
        rowEnd: functionCapture.node.endPosition.row + 1,
        columnStart: functionCapture.node.startPosition.column + 1,
        columnEnd: functionCapture.node.endPosition.column + 1,
        signature,
        scopeDefinedIn: scope.context,
        code: funcNode.text,
        character: getCharacterFromTreeSitterNode(functionCapture.node),
      })

      const lspCallees = await lspClient.getCallees(
        filePath,
        {
          line: functionCapture.node.startPosition.row,
          character: getCharacterFromTreeSitterNode(functionCapture.node),
        },
        false,
      )

      //console.log("function name", nameCapture.node.text)
      //console.log("lsp callee", lspCallees)

      this.graph.setEdge(fnId, moduleId, { type: RelationshipType.DEFINED_IN })

  
      if (nodeId) {
        this.graph.setEdge(fnId, nodeId, { type: RelationshipType.DEFINED_IN })
      }

    }

    console.log(`Extracted ${matches.length} functions from ${filePath}`)
  }
}
