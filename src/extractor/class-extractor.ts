import Parser from 'tree-sitter'
import { Extractor } from './extractor'
import { Neo4jClient } from '../db/neo4j-client'
import { DbSchema } from '../db/schema'
import { TreeSitterUtil } from '../util/tree-sitter-util'
import { ClassNodeService } from '../services/class-node-service'
import { CodeVectorStore } from '../vector-store'
import { Graph } from 'graphlib';

export class ClassExtractor extends Extractor {
  private classNodeService: ClassNodeService
   constructor(dbClient: Neo4jClient, treeSitterUtil: TreeSitterUtil, vectorStore: CodeVectorStore, graph: Graph) {
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

    const matches = query.matches(tree.rootNode)
    for (const match of matches) {
       const bodyCapture = match.captures.find(
          (c) => c.name === 'body'
        )

       const classCapture = match.captures.find(
          (c) => c.name === 'definition.class' || c.name === 'class_assignment' 
          || c.name === 'exported_class' || c.name === 'returned_class'
          || c.name === 'class'
        )
        const nameCapture = match.captures.find((c) => c.name === 'name')

        if(!classCapture) continue;

       // const classId = this.generateNodeId("class", filePath, )
 

        console.log("classCapture", classCapture.node.text)

        const classMethods = this.treeSitterUtils.getAllClassMembers(classCapture.node)
        const classFields = [];
        console.log("class method", classMethods)

        this.graph.setNode()
        classMethods.forEach(e => {
          //TODO Check the function node if the id exists else index it
          if(e.memberType === 'method'){
            const name = this.treeSitterUtils.extractFunctionName(e.node)
          const fnId = this.generateNodeId("function", name, 
            filePath, 
            e.node.startPosition.row + 1, 
            e.node.endPosition.row + 1,
            e.node.startPosition.column + 1,
            e.node.endPosition.column + 1
          ) 

          console.log("fn-ids", fnId)

          if(!this.graph.hasNode(fnId)) {
            const fnCalls = this.treeSitterUtils.findFunctionCalls(e.node)
             this.graph.setNode(fnId, {
              type: "function",
              name, 
              moduleDefinedIn: filePath, 
              rowStart: e.node.startPosition.row + 1,
              rowEnd: e.node.endPosition.row + 1,
              columnStart: e.node.startPosition.column + 1,
              columnEnd: e.node.endPosition.column + 1,
              signature: e.signature,
              scopeDefinedIn: `Class ${nameCapture.node.text}`,
              code: e.node.text,
              calls: fnCalls
             })
          }

          }else if (e.memberType === 'field') {
          //   const varId = this.generateNodeId("function", name, 
          //   filePath, 
          //   e.node.startPosition.row + 1, 
          //   e.node.endPosition.row + 1,
          //   e.node.startPosition.column + 1,
          //   e.node.endPosition.column + 1
          // ) 
          }else if(e.memberType === 'static_block') {

          }
          //index class

          //index class fields
           
          // this.graph.setNode("function", {

          // })

        })
       
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
