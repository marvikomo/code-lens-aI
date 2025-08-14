import Parser from 'tree-sitter'
import { Extractor } from './extractor'
import { Neo4jClient } from '../db/neo4j-client'
import { DbSchema } from '../db/schema'
import { TreeSitterUtil } from '../util/tree-sitter-util'
import { ClassNodeService } from '../services/class-node-service'
import { CodeVectorStore } from '../vector-store'
import { Graph } from 'graphlib'
import { RelationshipType } from '../enum/RelationshipType'

export class ClassExtractor extends Extractor {
  private classNodeService: ClassNodeService
  constructor(
    dbClient: Neo4jClient,
    treeSitterUtil: TreeSitterUtil,
    vectorStore: CodeVectorStore,
    graph: Graph,
  ) {
    super(dbClient, treeSitterUtil, vectorStore, graph)
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
    const moduleId = `mod:${filePath}`

    const matches = query.matches(tree.rootNode)
    for (const match of matches) {
      const bodyCapture = match.captures.find((c) => c.name === 'body')

      const classCapture = match.captures.find(
        (c) =>
          c.name === 'class',
      )
      const nameCapture = match.captures.find((c) => c.name === 'name')

      if (!classCapture) continue

      // const classId = this.generateNodeId("class", filePath, )

      function extractClassSignature(classCode: string): string {
        const lines = classCode.split('\n')
        let classDeclarationLines: string[] = []
        let braceFound = false
        let insideClass = false

        for (const line of lines) {
          const trimmedLine = line.trim()

          // Skip empty lines and comments before class declaration
          if (
            !insideClass &&
            (trimmedLine === '' || trimmedLine.startsWith('//'))
          ) {
            continue
          }

          // Start collecting when we find class keyword
          if (
            !insideClass &&
            (trimmedLine.includes('class ') || line.includes('class '))
          ) {
            insideClass = true
          }

          if (insideClass) {
            classDeclarationLines.push(line)

            // Che
            if (line.includes('{')) {
              braceFound = true
              break
            }
          }
        }

        if (!braceFound) {
          return classCode // Return original if no proper class structure found
        }

        // Join the declaration lines and clean up
        let declaration = classDeclarationLines.join('\n')

        // Remove everything after and including the opening brace
        const braceIndex = declaration.indexOf('{')
        if (braceIndex !== -1) {
          declaration = declaration.substring(0, braceIndex).trim()
        }

        return `${declaration} { }`
      }

      const classSignature = extractClassSignature(classCapture.node.text)

      console.log('classCapture', classCapture.node.text)
      console.log('NAME', nameCapture?.node.text)

      console.log("class signature", classSignature)

      const classMembers = this.treeSitterUtils.getAllClassMembers(
        classCapture.node,
      )

      const classId = this.generateNodeId("class", null, filePath , classCapture.node.startPosition.row + 1, classCapture.node.endPosition.row + 1, classCapture.node.startPosition.column + 1, classCapture.node.endPosition.column + 1)

      const _classMembers = classMembers.map((e: any) => {
        return {
          name: e.name,
          type: e.memberType,
          signature: e.signature,
          rowStart: e.node.startPosition.row + 1,
          rowEnd: e.node.endPosition.row + 1,
          columnStart: e.node.startPosition.column + 1,
          columnEnd: e.node.endPosition.column + 1,

        }
      })

      //console.log('class members', _classMembers)

      this.graph.setNode(classId, {
        type: 'class',
        name: nameCapture.node.text,
        moduleDefinedIn: filePath,
        rowStart: classCapture.node.startPosition.row + 1,
        rowEnd: classCapture.node.endPosition.row + 1,
        columnStart: classCapture.node.startPosition.column + 1,
        columnEnd: classCapture.node.endPosition.column + 1,
        signature: classSignature,
        methods: _classMembers
      })

       this.graph.setEdge(classId, moduleId, { type: RelationshipType.DEFINED_IN })
    }

    console.log(`Extracted ${matches.length} classes from ${filePath}`)

   
  }
}
