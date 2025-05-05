import { Neo4jClient } from '../db/neo4j-client'
import { DbSchema } from '../db/schema'
import Parser from 'tree-sitter'
import { DbUtils } from '../util/db-utils'

export class FunctionNodeService {
  private dbClient: Neo4jClient
  private dbUtils: DbUtils

  constructor(dbClient: Neo4jClient) {
    this.dbClient = dbClient
    this.dbUtils = new DbUtils(dbClient)
  }

  // Public function to index a function by passing the function node
  protected async indexFunction(
    functionNode: Parser.SyntaxNode,
    funcName: string,
    filePath: string,
  ): Promise<string> {
    const startPosition = functionNode.startPosition
    const endPosition = functionNode.endPosition

    // Function source code (trimmed if too long)
    const sourceCode =
      functionNode.text.length > 1000
        ? functionNode.text.substring(0, 1000) + '...'
        : functionNode.text

    // Generate unique ID
    const functionId = this.dbUtils.generateNodeId(
      'func',
      funcName,
      filePath,
      startPosition.row,
      startPosition.column,
    )

    // Extract parameters
    const parameters = this.extractParameters(functionNode)

    // Index the function in Neo4j
    await this.dbClient.runInTransaction(async (session) => {
      // Create or update function node
      await session.run(
        `
            MERGE (f:${DbSchema.labels.FUNCTION} {id: $functionId})
            ON CREATE SET 
              f.name = $funcName,
              f.fullName = $funcName,
              f.lineStart = $lineStart,
              f.lineEnd = $lineEnd,
              f.columnStart = $columnStart,
              f.columnEnd = $columnEnd,
              f.parameters = $parameters,
              f.sourceCode = $sourceCode,
              f.createdAt = timestamp()
            ON MATCH SET
              f.name = $funcName,
              f.fullName = $funcName,
              f.lineStart = $lineStart,
              f.lineEnd = $lineEnd,
              f.columnStart = $columnStart,
              f.columnEnd = $columnEnd,
              f.parameters = $parameters,
              f.sourceCode = $sourceCode,
              f.updatedAt = timestamp()
          `,
        {
          functionId,
          funcName,
          lineStart: startPosition.row,
          lineEnd: endPosition.row,
          columnStart: startPosition.column,
          columnEnd: endPosition.column,
          parameters,
          sourceCode,
        },
      )

      // Create relationship to module
      const moduleId = `mod:${filePath}`
      await session.run(
        `
            MATCH (f:${DbSchema.labels.FUNCTION} {id: $functionId})
            MATCH (m:${DbSchema.labels.MODULE} {id: $moduleId})
            MERGE (f)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
          `,
        { functionId, moduleId },
      )
    })

    console.log(`Function indexed: ${funcName} in ${filePath}`)

    return functionId
  }

  public async indexFunctionsInBatch(
    functionsData: {
      functionNode: Parser.SyntaxNode
      funcName: string
      filePath: string
    }[],
  ): Promise<void> {
    // Collect all the functions' indexing data into an array of parameters
    const functionsParams = functionsData.map(
      ({ functionNode, funcName, filePath }) => {
        const startPosition = functionNode.startPosition
        const endPosition = functionNode.endPosition

        // Function source code (trimmed if too long)
        const sourceCode =
          functionNode.text.length > 1000
            ? functionNode.text.substring(0, 1000) + '...'
            : functionNode.text

        // Generate unique ID
        const functionId = this.dbUtils.generateNodeId(
          'func',
          funcName,
          filePath,
          startPosition.row,
          startPosition.column,
        )

        // Extract parameters
        const parameters = this.extractParameters(functionNode)

        return {
          functionId,
          funcName,
          lineStart: startPosition.row,
          lineEnd: endPosition.row,
          columnStart: startPosition.column,
          columnEnd: endPosition.column,
          parameters,
          sourceCode,
          filePath,
        }
      },
    )

    // Execute all the indexing in a single transaction using UNWIND
    await this.dbClient.runInTransaction(async (session) => {
      // Create or update function nodes and relationships in bulk
      await session.run(
        `
              UNWIND $functions AS function
              MERGE (f:${DbSchema.labels.FUNCTION} {id: function.functionId})
              ON CREATE SET 
                f.name = function.funcName,
                f.fullName = function.funcName,
                f.lineStart = function.lineStart,
                f.lineEnd = function.lineEnd,
                f.columnStart = function.columnStart,
                f.columnEnd = function.columnEnd,
                f.parameters = function.parameters,
                f.sourceCode = function.sourceCode,
                f.createdAt = timestamp()
              ON MATCH SET
                f.name = function.funcName,
                f.fullName = function.funcName,
                f.lineStart = function.lineStart,
                f.lineEnd = function.lineEnd,
                f.columnStart = function.columnStart,
                f.columnEnd = function.columnEnd,
                f.parameters = function.parameters,
                f.sourceCode = function.sourceCode,
                f.updatedAt = timestamp()
            `,
        { functions: functionsParams },
      )

      // Create relationships for each function to its module in bulk
      const moduleIds = functionsParams.map((f) => `mod:${f.filePath}`)
      await session.run(
        `
              UNWIND $functions AS function
              MATCH (f:${DbSchema.labels.FUNCTION} {id: function.functionId})
              MATCH (m:${DbSchema.labels.MODULE}) 
              WHERE m.id IN $moduleIds
              MERGE (f)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
            `,
        { functions: functionsParams, moduleIds },
      )
    })

    console.log(`Indexed ${functionsData.length} functions in batch.`)
  }

  /**
   * Get an indexed function by its unique ID from Neo4j
   */
  public async getFunctionById(functionId: string): Promise<any> {
    try {
      // Query to get the function from Neo4j by its unique ID
      const result = await this.dbClient.query(
        `
        MATCH (f:${DbSchema.labels.FUNCTION} {id: $functionId})
        RETURN f.id AS functionId, 
               f.name AS funcName, 
               f.fullName AS funcFullName, 
               f.lineStart AS lineStart, 
               f.lineEnd AS lineEnd, 
               f.columnStart AS columnStart, 
               f.columnEnd AS columnEnd, 
               f.parameters AS parameters, 
               f.sourceCode AS sourceCode, 
               f.createdAt AS createdAt, 
               f.updatedAt AS updatedAt
      `,
        { functionId },
      )

      // Check if a function was found
      if (result.length === 0) {
        console.log(`Function with ID ${functionId} not found.`)
        return null // Or you can throw an error if needed
      }

      // Return the function details from the query result
      return result[0]
    } catch (error) {
      console.error('Error retrieving function from Neo4j:', error)
      throw error // Re-throw the error or return a custom error response
    }
  }

  public async searchFunctions(searchParams: {
    name?: string
    filePath?: string
    startLine?: number
    endLine?: number
    limit?: number
  }): Promise<any[]> {
    try {
      const { name, filePath, startLine, endLine, limit = 10 } = searchParams

      // Build the query based on available parameters
      let query = `MATCH (f:${DbSchema.labels.FUNCTION})`
      const queryParams: Record<string, any> = {}

      // For file path, we need to match with the module
      if (filePath) {
        query = `MATCH (f:${DbSchema.labels.FUNCTION})-[:${DbSchema.relationships.DEFINED_IN}]->(m:${DbSchema.labels.MODULE})`
        query += ` WHERE m.id = $moduleId`
        queryParams.moduleId = `mod:${filePath}`
      }

      // Add WHERE clauses for filtering
      const whereClauses: string[] = []
      if (name) {
        whereClauses.push(
          `(f.name CONTAINS $name OR f.fullName CONTAINS $name)`,
        )
        queryParams.name = name
      }

      // Add line range filtering
      if (startLine !== undefined) {
        whereClauses.push(`f.lineStart >= $startLine`)
        queryParams.startLine = startLine
      }

      if (endLine !== undefined) {
        whereClauses.push(`f.lineEnd <= $endLine`)
        queryParams.endLine = endLine
      }

      // Add the WHERE clause if we have additional conditions beyond the file path
      if (whereClauses.length > 0) {
        if (filePath) {
          query += ` AND ${whereClauses.join(' AND ')}`
        } else {
          query += ` WHERE ${whereClauses.join(' AND ')}`
        }
      }

      // Complete the query with return statement and pagination
      query += `
        RETURN f.id AS functionId, 
               f.name AS funcName, 
               f.fullName AS funcFullName, 
               f.lineStart AS lineStart, 
               f.lineEnd AS lineEnd, 
               f.columnStart AS columnStart, 
               f.columnEnd AS columnEnd, 
               f.parameters AS parameters, 
               f.sourceCode AS sourceCode, 
               f.createdAt AS createdAt, 
               f.updatedAt AS updatedAt
        ${filePath ? ', m.path AS filePath' : ''}
        ORDER BY f.lineStart ASC
        LIMIT $limit
      `
      queryParams.limit = limit

      // Execute the query
      const results = await this.dbClient.query(query, queryParams)

      // If no file path was provided in the search, we need to add it to the results
      if (!filePath) {
        // Fetch the module paths for each function
        const functionIds = results.map((func) => func.functionId)
        if (functionIds.length > 0) {
          const pathQuery = `
            MATCH (f:${DbSchema.labels.FUNCTION})-[:${DbSchema.relationships.DEFINED_IN}]->(m:${DbSchema.labels.MODULE})
            WHERE f.id IN $functionIds
            RETURN f.id AS functionId, m.path AS filePath
          `
          const pathResults = await this.dbClient.query(pathQuery, {
            functionIds,
          })

          // Create a map of functionId to filePath
          const pathMap = new Map<string, string>()
          for (const path of pathResults) {
            pathMap.set(path.functionId, path.filePath)
          }

          // Add filePath to each result
          for (const result of results) {
            result.filePath = pathMap.get(result.functionId) || ''
          }
        }
      }

      return results
    } catch (error) {
      console.error('Error searching functions from Neo4j:', error)
      throw error
    }
  }

  /**
   * Extract parameter information from a function node
   */
  private extractParameters(funcNode: Parser.SyntaxNode): string[] {
    try {
      // Find parameters node (formal_parameters)
      const paramsNode = funcNode.children.find(
        (child) =>
          child.type === 'formal_parameters' || child.type === 'parameter_list',
      )

      if (!paramsNode) return []

      // Extract parameter names (skipping commas, etc.)
      return paramsNode.children
        .filter(
          (child) => child.type === 'identifier' || child.type === 'pattern',
        )
        .map((child) => child.text)
    } catch (error) {
      console.error('Error extracting parameters:', error)
      return []
    }
  }
}
