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
    name?: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    limit?: number;
  }): Promise<any[]> {
    try {
      const { 
        name, 
        filePath 
      } = searchParams;
      
      // Convert numeric parameters to integers explicitly
      const startLine = searchParams.startLine !== undefined ? parseInt(String(searchParams.startLine), 10) : undefined;
      const endLine = searchParams.endLine !== undefined ? parseInt(String(searchParams.endLine), 10) : undefined;
      const limit = searchParams.limit !== undefined ? parseInt(String(searchParams.limit), 10) : 10;
      
      // Build the query with file path matching if provided
      let query = filePath 
        ? `MATCH (f:${DbSchema.labels.FUNCTION})-[:${DbSchema.relationships.DEFINED_IN}]->(m:${DbSchema.labels.MODULE} {id: $moduleId})`
        : `MATCH (f:${DbSchema.labels.FUNCTION})`;
      
      const queryParams: Record<string, any> = {};
      if (filePath) {
        queryParams.moduleId = `mod:${filePath}`;
      }
      
      // Build individual criteria for WHERE clause
      const criteria: string[] = [];
      
      if (name) {
        criteria.push(`(f.name CONTAINS $name OR f.fullName CONTAINS $name)`);
        queryParams.name = name;
      }
      
      if (startLine !== undefined) {
        criteria.push(`(f.lineStart <= $startLine AND f.lineEnd >= $startLine)`);
        queryParams.startLine = startLine;
      }
      
      if (endLine !== undefined) {
        criteria.push(`(f.lineStart <= $endLine AND f.lineEnd >= $endLine)`);
        queryParams.endLine = endLine;
      }
      
      // Add WHERE clause if we have any criteria
      if (criteria.length > 0) {
        // Use OR between criteria - match if ANY criterion matches
        query += ` WHERE ${criteria.join(' OR ')}`;
      }
      
      // Add return clause
      query += `
        RETURN f.id AS functionId, 
               f.name AS funcName, 
               f.fullName AS funcFullName, 
               f.lineStart AS lineStart, 
               f.lineEnd AS lineEnd, 
               f.columnStart AS columnStart, 
               f.columnEnd AS columnEnd, 
               f.parameters AS parameters, 
               f.sourceCode AS sourceCode
        ${filePath ? ', m.path AS filePath' : ''}
        ORDER BY f.lineStart ASC
      `;
      
      // Add LIMIT clause directly in the query
      query += ` LIMIT 1`;
      
      // Execute the query
      const results = await this.dbClient.query(query, queryParams);
      
      return results;
    } catch (error) {
      console.error('Error searching functions from Neo4j:', error);
      throw error;
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
