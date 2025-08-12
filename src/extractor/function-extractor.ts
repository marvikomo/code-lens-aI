import Parser from 'tree-sitter'
import { Extractor } from './extractor'
import { Neo4jClient } from '../db/neo4j-client'
import { FunctionNodeService } from '../services/function-node-service'

import { logger } from '../logger'
import { TreeSitterUtil } from '../util/tree-sitter-util'
import { CodeChunk, CodeVectorStore } from '../vector-store'
import { Graph } from 'graphlib';

export class FunctionExtractor extends Extractor {
  private functionNodeService: FunctionNodeService
  constructor(dbClient: Neo4jClient, treeSitterUtil: TreeSitterUtil, vectorStore: CodeVectorStore, graph: Graph) {
    super(dbClient, treeSitterUtil, vectorStore, graph)
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
    const moduleId = `mod:${filePath}`;
   // logger.writeResults(matches, 'matches')

     for (const match of matches) {

      // Get function node and name capture
      const functionCapture = match.captures.find((c) => c.name === 'function' ||  c.name === 'method' || c.name === 'iife' || c.name === 'generator_function')
      const nameCapture = match.captures.find((c) => c.name === 'name')
    
      if (!functionCapture) continue

      const funcNode = functionCapture.node
      console.log("extracting")
    
    
      //console.log("fn calls", this.treeSitterUtils.findFunctionCalls(funcNode))
      const scope =  this.treeSitterUtils.determineNodeContext(funcNode)
      const signature =  this.treeSitterUtils.extractFunctionSignature(funcNode)
      const name = this.treeSitterUtils.extractFunctionName(funcNode)
      const fnCalls = this.treeSitterUtils.findFunctionCalls(funcNode)
      const fnId = this.generateNodeId('function', name, filePath, funcNode.startPosition.row + 1, funcNode.endPosition.row + 1, funcNode.startPosition.column + 1, funcNode.endPosition.column + 1)
      const nodeId = this.generateNodeId('node', scope.name, filePath, scope.parentNode.startPosition.row + 1, scope.parentNode.endPosition.row + 1, scope.parentNode.startPosition.column + 1, scope.parentNode.endPosition.column + 1)

      const calls = []
      console.log("fn ids", fnId)

        this.graph.setNode(fnId, { 
            type: 'function',
             name, 
             moduleDefinedIn: filePath, 
             rowStart: functionCapture.node.startPosition.row + 1,
             rowEnd: functionCapture.node.endPosition.row + 1,
             columnStart: functionCapture.node.startPosition.column + 1,
             columnEnd: functionCapture.node.endPosition.column + 1,
             signature,
             scopeDefinedIn: scope.context,
             code: funcNode.text,
             calls: calls
         })
    

        this.graph.setEdge(fnId, moduleId, { type: 'defined in module'})

        this.graph.setNode(nodeId, {
          type: 'node',
          name: scope.name,
          rowStart: scope.parentNode.startPosition.row + 1,
          rowEnd: scope.parentNode.endPosition.row + 1,
          columnStart: scope.parentNode.startPosition.column + 1,
          columnEnd: scope.parentNode.endPosition.column + 1,
          scopeType: scope.type

        })

        this.graph.setEdge(fnId, nodeId, { type: "Defined under"})

       fnCalls.forEach(call => {
        calls.push({
          text: call.node.text,
          rowStart: call.node.startPosition.row + 1,
          rowEnd: call.node.endPosition.row + 1,
          columnStart: call.node.startPosition.column + 1,
          columnEnd: call.node.endPosition.column + 1,
          name: call.functionName,
          callType: call.callType,
          arguments: call.arguments.map(arg => arg.text)
        })    
        
        const calleeId = this.generateNodeId('callee', name, filePath, call.node.startPosition.row + 1, call.node.endPosition.row + 1, call.node.startPosition.column + 1, call.node.endPosition.column + 1)

        this.graph.setNode(calleeId, { 
          type: "callee",
          moduleDefinedIn: filePath, 
          code: call.node.text,
          rowStart: call.node.startPosition.row + 1,
          rowEnd: call.node.endPosition.row + 1,
          columnStart: call.node.startPosition.column + 1,
          columnEnd: call.node.endPosition.column + 1,
          name: call.functionName,
          callType: call.callType,
          arguments: call.arguments.map(arg => arg.text)
         })

        this.graph.setEdge(fnId, calleeId, { type: 'calls'})
        this.graph.setEdge(calleeId, moduleId, { type: 'defined in module'})
        
      })

       
        const nodeData = this.graph.node(fnId);
        nodeData.calls = calls

        //console.log("nodedata", nodeData)
        

      // Get function details
      //const funcName = nameCapture ? nameCapture.node.text : '<anonymous>'

      // functionIndexes.push({
      //   functionNode: funcNode,
      //   funcName,
      //   filePath,
      // })

      // chunks.push({
      //   content: funcNode.text,
      //   language: 'typescript',
      //   type: 'function',
      //   name: funcName,
      //   startLine: funcNode.startPosition.row,
      //   endLine: funcNode.endPosition.row,
      //   filePath,
      //   metadata: {
      //     imports: [],
      //     exports: [],
      //     dependencies: []
      //   }
      // })
     
    }

    console.log(`Extracted ${matches.length} functions from ${filePath}`)
  }


  buildGraphFromFunctionNode(node: Parser.SyntaxNode, filePath, moduleId): void {

      //console.log("fn calls", this.treeSitterUtils.findFunctionCalls(funcNode))
      const scope =  this.treeSitterUtils.determineNodeContext(node)
      const signature =  this.treeSitterUtils.extractFunctionSignature(node)
      const name = this.treeSitterUtils.extractFunctionName(node)
      const fnCalls = this.treeSitterUtils.findFunctionCalls(node)
      const fnId = this.generateNodeId('function', name, filePath, node.startPosition.row + 1, node.endPosition.row + 1, node.startPosition.column + 1, node.endPosition.column + 1)
      const nodeId = this.generateNodeId('node', scope.name, filePath, scope.parentNode.startPosition.row + 1, scope.parentNode.endPosition.row + 1, scope.parentNode.startPosition.column + 1, scope.parentNode.endPosition.column + 1)

      const calls = []
      console.log("fn ids", fnId)
        
      //Set function node
        this.graph.setNode(fnId, { 
            type: 'function',
             name, 
             moduleDefinedIn: filePath, 
             rowStart: node.startPosition.row + 1,
             rowEnd: node.endPosition.row + 1,
             columnStart: node.startPosition.column + 1,
             columnEnd: node.endPosition.column + 1,
             signature,
             scopeDefinedIn: scope.context,
             code: node.text,
             calls: calls
         })
    
        
        this.graph.setEdge(fnId, moduleId, { type: 'defined in module'})

        this.graph.setNode(nodeId, {
          type: 'node',
          name: scope.name,
          rowStart: scope.parentNode.startPosition.row + 1,
          rowEnd: scope.parentNode.endPosition.row + 1,
          columnStart: scope.parentNode.startPosition.column + 1,
          columnEnd: scope.parentNode.endPosition.column + 1,
          scopeType: scope.type

        })

        this.graph.setEdge(fnId, nodeId, { type: "Defined under"})

       fnCalls.forEach(call => {
        calls.push({
          text: call.node.text,
          rowStart: call.node.startPosition.row + 1,
          rowEnd: call.node.endPosition.row + 1,
          columnStart: call.node.startPosition.column + 1,
          columnEnd: call.node.endPosition.column + 1,
          name: call.functionName,
          callType: call.callType,
          arguments: call.arguments.map(arg => arg.text)
        })    
        
        const calleeId = this.generateNodeId('callee', name, filePath, call.node.startPosition.row + 1, call.node.endPosition.row + 1, call.node.startPosition.column + 1, call.node.endPosition.column + 1)

        this.graph.setNode(calleeId, { 
          type: "callee",
          moduleDefinedIn: filePath, 
          code: call.node.text,
          rowStart: call.node.startPosition.row + 1,
          rowEnd: call.node.endPosition.row + 1,
          columnStart: call.node.startPosition.column + 1,
          columnEnd: call.node.endPosition.column + 1,
          name: call.functionName,
          callType: call.callType,
          arguments: call.arguments.map(arg => arg.text)
         })

        this.graph.setEdge(fnId, calleeId, { type: 'calls'})
        this.graph.setEdge(calleeId, moduleId, { type: 'defined in module'})
        
      })

       
        const nodeData = this.graph.node(fnId);
        nodeData.calls = calls

  }



   /**
   * Extract functions from a parsed file and store in Neo4j
   */
  // async extract(
  //   tree: Parser.Tree,
  //   content: string,
  //   filePath: string,
  //   query: Parser.Query,
  // ): Promise<void> {
  //   // Ensure module node exists
  //   await this.ensureModuleNode(filePath)

  //   // Create function query
  //   const matches = query.matches(tree.rootNode)

  //   logger.writeResults(matches, 'matches')

  //   //Process in batches
  //   const batchSize = 20
  //   for (let i = 0; i < matches.length; i += batchSize) {
  //     const batch = matches.slice(i, i + batchSize)
  //     await this.processFunctionBatch(batch, content, filePath)
  //   }

  //   console.log(`Extracted ${matches.length} functions from ${filePath}`)
  // }

  /**
   * Process a batch of function matches
   */
  private async processFunctionBatch(
    matches: Parser.QueryMatch[],
    content: string,
    filePath: string,
  ): Promise<void> {
    const functionIndexes = []
    let chunks: CodeChunk[] = [];

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

      chunks.push({
        content: funcNode.text,
        language: 'typescript',
        type: 'function',
        name: funcName,
        startLine: funcNode.startPosition.row,
        endLine: funcNode.endPosition.row,
        filePath,
        metadata: {
          imports: [],
          exports: [],
          dependencies: []
        }
      })
     
    }

    let v =  this.vectorStore.createDocumentsFromChunks(chunks)

    let c = await this.vectorStore.indexDocuments(v);
   // console.log(c)

    await this.functionNodeService.indexFunctionsInBatch(functionIndexes)
  }
}
