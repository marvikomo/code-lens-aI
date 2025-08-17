import { Graph } from 'graphlib'
import { RelationshipType } from '../enum/RelationshipType'
import { GraphUtil } from '../util/graph-utils'

export class CallExtractor  {

  private graph: Graph
  private graphUtil: GraphUtil

  constructor(
    graph: Graph,
  ) {
   this.graph = graph
   this.graphUtil = new GraphUtil(graph)
  }

  /**
   * Extract function calls from a parsed file and store in Neo4j
   */
  async extract(
    filePath: string,
    lspClient: any = null,
  ): Promise<void> {
    const moduleId = `mod:${filePath}`
    const fns = this.graphUtil.getFunctionsFromGraph(filePath)
    console.log('Functions found in graph:', JSON.stringify(fns))

    console.log('Extracting calls from file:', filePath)
  
    for (const fn of fns) {
      const id = fn.id
      const lspCallees = await lspClient.getCallees(
        filePath,
        {
          line: fn.rowStart - 1,
          character: fn.character,
        },
        false,
      )
      console.log("fn name", fn.name)
      //exclude node modules
      const filteredCallees = lspCallees.filter(callee => 
        callee && 
        callee.file && 
        typeof callee.file === 'string' && 
        !callee.file.includes('node_modules')
      )
      console.log("lsp callee (all):", lspCallees.length)
      console.log("lsp callee (filtered):", filteredCallees)
      const calls = []
      for(const callee of filteredCallees) {
        console.log(`Looking for callee: ${callee.name} in file: ${callee.file} at line: ${callee.line + 1} (1-based)`)
        
        // Find the callee function in the graph by matching file path, function name, and line
        const calleeFunction = this.graphUtil.findFunctionByFilePathAndLine(callee.file, callee.line)
        console.log("calleeFunction", calleeFunction)
         calls.push({
          id: calleeFunction.id,
          name: calleeFunction.name,
          file: callee.file,
          rowStart: calleeFunction.rowStart,
          rowEnd: calleeFunction.rowEnd,
          columnStart: calleeFunction.columnStart,
          columnEnd: calleeFunction.columnEnd,
          signature: calleeFunction.signature
         })
 
         this.graph.setEdge(id, calleeFunction.id, { type: RelationshipType.CALLS })
         this.graph.setEdge(moduleId, calleeFunction.id, { type: RelationshipType.IMPORTS })
    
      }

        const existingData = this.graph.node(id)
        if (existingData) {
          console.log(`Updating existing function node: ${id}`)
          this.graph.setNode(id, {
            ...existingData,
            calls: calls,
          })
        }

    }

    //Get all functions with their edge relationships
    //const allFunctions = this.getAllFunctionsWithEdges()
     const allFunctions = this.graphUtil.getAllFunctions()
    console.log('All functions with relationships:', JSON.stringify(allFunctions, null, 2))



  }
}