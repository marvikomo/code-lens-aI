import { Graph } from 'graphlib'
import { RelationshipType } from '../enum/RelationshipType'

export class GraphUtil {
  //we need to have a constructor to initialize the graph
  constructor(private graph: Graph) {}

  /**
   * Get all functions from the graph for a specific file
   */
  public getFunctionsFromGraph(filePath?: string): any[] {
    const functions: any[] = []

    for (const nodeId of this.graph.nodes()) {
      const nodeData = this.graph.node(nodeId)

      if (nodeData && nodeData.type === 'function') {
        // If filePath is specified, filter by that file
        if (!filePath || nodeData.moduleDefinedIn === filePath) {
          functions.push({
            id: nodeId,
            ...nodeData,
          })
        }
      }
    }

    return functions
  }

  /**
   * Get all calls from the graph for a specific file
   */
  public getCallsFromGraph(filePath?: string): any[] {
    const calls: any[] = []

    for (const nodeId of this.graph.nodes()) {
      const nodeData = this.graph.node(nodeId)

      if (nodeData && nodeData.type === 'Call') {
        // If filePath is specified, filter by module
        if (!filePath || nodeData.module === `mod:${filePath}`) {
          calls.push(nodeData)
        }
      }
    }

    return calls
  }

  /**
   * Get function call relationships from the graph
   */
  public getCallRelationshipsFromGraph(): any[] {
    const relationships: any[] = []

    for (const edgeData of this.graph.edges()) {
      const edge = this.graph.edge(edgeData)

      if (
        edge &&
        (edge.type === RelationshipType.CALLS || edge.type === 'REFERS_TO')
      ) {
        relationships.push({
          source: edgeData.v,
          target: edgeData.w,
          type: edge.type,
          ...edge,
        })
      }
    }

    return relationships
  }

  /**
   * List all nodes in the graph with their data
   */
  public listAllNodes(): any[] {
    return this.graph.nodes().map((nodeId) => ({
      id: nodeId,
      data: this.graph.node(nodeId),
    }))
  }

  /**
   * Get nodes by type
   */
  public getNodesByType(type: string): any[] {
    return this.graph
      .nodes()
      .map((nodeId) => ({ id: nodeId, data: this.graph.node(nodeId) }))
      .filter((node) => node.data?.type === type)
  }

  /**
   * Get graph statistics
   */
  public getGraphStats(): any {
    const stats = {
      totalNodes: this.graph.nodes().length,
      totalEdges: this.graph.edges().length,
      nodeTypes: {} as Record<string, number>,
    }

    this.graph.nodes().forEach((nodeId) => {
      const nodeData = this.graph.node(nodeId)
      const type = nodeData?.type || 'unknown'
      stats.nodeTypes[type] = (stats.nodeTypes[type] || 0) + 1
    })

    return stats
  }

  /**
   * Print graph summary to console
   */
  public printGraphSummary(): void {
    const stats = this.getGraphStats()
    console.log('=== Graph Summary ===')
    console.log(`Total Nodes: ${stats.totalNodes}`)
    console.log(`Total Edges: ${stats.totalEdges}`)
    console.log('Node Types:')
    Object.entries(stats.nodeTypes).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`)
    })
  }

  /**
   * Find a callee function in the graph by name and file path
   */
  private findCalleeInGraph(
    functionName: string,
    filePath: string,
    lspCalleeInfo?: any,
  ): any | null {
    // If LSP callee info is provided and has line information, try exact line match first
    if (lspCalleeInfo && typeof lspCalleeInfo.line === 'number') {
      const lspLineOneBased = lspCalleeInfo.line + 1 // Convert 0-based to 1-based

      // Try exact line match
      const exactMatch = this.findFunctionByFilePathAndLine(
        filePath,
        lspLineOneBased,
      )
      if (exactMatch && exactMatch.name === functionName) {
        console.log(
          `✓ Exact line match found: ${functionName} at line ${lspLineOneBased}`,
        )
        return exactMatch
      }

      // Try with tolerance if exact line doesn't match
      const toleranceMatch = this.findFunctionByFilePathAndLineWithTolerance(
        filePath,
        lspLineOneBased,
        3,
      )
      if (toleranceMatch && toleranceMatch.name === functionName) {
        console.log(
          `✓ Tolerance match found: ${functionName} near line ${lspLineOneBased}`,
        )
        return toleranceMatch
      }

      console.log(
        `No line-based match found for ${functionName} at line ${lspLineOneBased}`,
      )
    }

    // Fallback: traditional name and file path matching
    for (const nodeId of this.graph.nodes()) {
      const nodeData = this.graph.node(nodeId)

      if (
        nodeData &&
        nodeData.type === 'function' &&
        nodeData.name === functionName &&
        nodeData.moduleDefinedIn === filePath
      ) {
        console.log(
          `⚠ Fallback name match found: ${functionName} in file ${filePath}`,
        )
        return {
          id: nodeId,
          ...nodeData,
        }
      }
    }

    // Debug: Show all functions in the file if no match found
    const allFunctionsInFile = this.findAllFunctionsInFile(filePath)
    if (allFunctionsInFile.length > 0) {
      console.log(`Available functions in ${filePath}:`)
      allFunctionsInFile.forEach((fn) => {
        console.log(`  - ${fn.name} at line ${fn.rowStart}`)
      })
    }

    return null
  }

  /**
   * Find a function in the graph by file path and line number
   */
  public findFunctionByFilePathAndLine(
    filePath: string,
    line: number,
  ): any | null {
    for (const nodeId of this.graph.nodes()) {
      const nodeData = this.graph.node(nodeId)

      if (
        nodeData &&
        nodeData.type === 'function' &&
        nodeData.moduleDefinedIn === filePath &&
        nodeData.rowStart === line
      ) {
        return {
          id: nodeId,
          ...nodeData,
        }
      }
    }
    return null
  }

  /**
   * Find a function in the graph by file path and line number with tolerance
   */
  private findFunctionByFilePathAndLineWithTolerance(
    filePath: string,
    line: number,
    tolerance: number = 2,
  ): any | null {
    const candidates: any[] = []

    for (const nodeId of this.graph.nodes()) {
      const nodeData = this.graph.node(nodeId)

      if (
        nodeData &&
        nodeData.type === 'function' &&
        nodeData.moduleDefinedIn === filePath
      ) {
        // Calculate line difference
        const lineDiff = Math.abs(nodeData.rowStart - line)

        if (lineDiff <= tolerance) {
          candidates.push({
            id: nodeId,
            ...nodeData,
            lineDifference: lineDiff,
          })
        }
      }
    }

    // Return the closest match (smallest line difference)
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.lineDifference - b.lineDifference)
      const closest = candidates[0]
      console.log(
        `Found function with tolerance: ${closest.name} at line ${closest.rowStart} (requested line ${line}, diff: ${closest.lineDifference})`,
      )
      return closest
    }

    return null
  }

  /**
   * Find all functions in a specific file
   */
  private findAllFunctionsInFile(filePath: string): any[] {
    const functions: any[] = []

    for (const nodeId of this.graph.nodes()) {
      const nodeData = this.graph.node(nodeId)

      if (
        nodeData &&
        nodeData.type === 'function' &&
        nodeData.moduleDefinedIn === filePath
      ) {
        functions.push({
          id: nodeId,
          ...nodeData,
        })
      }
    }

    return functions.sort((a, b) => a.rowStart - b.rowStart) // Sort by line number
  }

  /**
   * Get all functions from the graph as an array of objects
   */
  public getAllFunctions(): any[] {
    const functions: any[] = []

    for (const nodeId of this.graph.nodes()) {
      const nodeData = this.graph.node(nodeId)

      if (nodeData && nodeData.type === 'function') {
        functions.push({
          id: nodeId,
          name: nodeData.name,
          moduleDefinedIn: nodeData.moduleDefinedIn,
          rowStart: nodeData.rowStart,
          rowEnd: nodeData.rowEnd,
          character: nodeData.character,
          ...nodeData,
        })
      }
    }

    // Sort by file path, then by line number
    return functions.sort((a, b) => {
      const fileComparison = (a.moduleDefinedIn || '').localeCompare(
        b.moduleDefinedIn || '',
      )
      if (fileComparison !== 0) return fileComparison
      return (a.rowStart || 0) - (b.rowStart || 0)
    })
  }

  /**
   * Get all functions with their edge relationships
   */
  public getAllFunctionsWithEdges(): any[] {
    const functions: any[] = []

    for (const nodeId of this.graph.nodes()) {
      const nodeData = this.graph.node(nodeId)

      if (nodeData && nodeData.type === 'function') {
        // Get outgoing edges (functions this function calls)
        const outgoingEdges = this.graph.outEdges(nodeId) || []
        const callsTo = outgoingEdges.map((edge) => {
          const edgeData = this.graph.edge(edge)
          const targetNode = this.graph.node(edge.w)
          return {
            edgeId: `${edge.v}-${edge.w}`,
            targetId: edge.w,
            targetName: targetNode?.name || 'unknown',
            targetType: targetNode?.type || 'unknown',
            targetFile: targetNode?.moduleDefinedIn,
            relationshipType: edgeData?.type || 'unknown',
            edgeData,
          }
        })

        // Get incoming edges (functions that call this function)
        const incomingEdges = this.graph.inEdges(nodeId) || []
        const calledBy = incomingEdges.map((edge) => {
          const edgeData = this.graph.edge(edge)
          const sourceNode = this.graph.node(edge.v)
          return {
            edgeId: `${edge.v}-${edge.w}`,
            sourceId: edge.v,
            sourceName: sourceNode?.name || 'unknown',
            sourceType: sourceNode?.type || 'unknown',
            sourceFile: sourceNode?.moduleDefinedIn,
            relationshipType: edgeData?.type || 'unknown',
            edgeData,
          }
        })

        functions.push({
          id: nodeId,
          name: nodeData.name,
          moduleDefinedIn: nodeData.moduleDefinedIn,
          rowStart: nodeData.rowStart,
          rowEnd: nodeData.rowEnd,
          character: nodeData.character,
          ...nodeData,
          relationships: {
            callsTo: callsTo,
            calledBy: calledBy,
            totalOutgoing: outgoingEdges.length,
            totalIncoming: incomingEdges.length,
          },
        })
      }
    }

    // Sort by file path, then by line number
    return functions.sort((a, b) => {
      const fileComparison = (a.moduleDefinedIn || '').localeCompare(
        b.moduleDefinedIn || '',
      )
      if (fileComparison !== 0) return fileComparison
      return (a.rowStart || 0) - (b.rowStart || 0)
    })
  }

  /**
   * Create a call relationship between caller and callee
   */
  private async createCallRelationship(
    callerId: string,
    calleeId: string,
    lspCalleeInfo: any,
  ): Promise<void> {
    try {
      // Generate a unique call ID
      const callId = `call:${callerId}:${calleeId}:${lspCalleeInfo.callSite.line}:${lspCalleeInfo.callSite.column}`

      // Create call node in graph
      const callData = {
        type: 'call',
        callerFunctionId: callerId,
        calleeFunctionId: calleeId,
        calleeName: lspCalleeInfo.name,
        callSiteLine: lspCalleeInfo.callSite.line,
        callSiteColumn: lspCalleeInfo.callSite.column,
        targetFile: lspCalleeInfo.file,
        targetLine: lspCalleeInfo.line,
        targetColumn: lspCalleeInfo.column,
      }

      // Add call node to graph
      this.graph.setNode(callId, callData)

      // Create edges: caller -> call -> callee
      this.graph.setEdge(callerId, callId, {
        type: 'CALLS',
        source: callerId,
        target: callId,
      })

      this.graph.setEdge(callId, calleeId, {
        type: 'REFERS_TO',
        source: callId,
        target: calleeId,
      })

      console.log(
        `Created call relationship: ${callerId} -> ${callId} -> ${calleeId}`,
      )
    } catch (error) {
      console.error('Error creating call relationship:', error)
    }
  }
}
