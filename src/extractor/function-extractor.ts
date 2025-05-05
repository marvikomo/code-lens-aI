import Parser from 'tree-sitter';
import { Extractor } from './extractor';
import { Neo4jClient } from '../db/neo4j-client';
import { DbSchema } from '../db/schema';

import { logger } from '../logger';

export class FunctionExtractor extends Extractor {
  
    constructor(dbClient: Neo4jClient) {
      super(dbClient);
    }

      /**
   * Extract functions from a parsed file and store in Neo4j
   */
  async extract(
    tree: Parser.Tree, 
    content: string, 
    filePath: string, 
    query: Parser.Query
  ): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath);
    
    // Create function query
    const matches = query.matches(tree.rootNode);

    logger.writeResults(matches, "matches");
    
    //Process in batches
    const batchSize = 20;
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize);
      await this.processFunctionBatch(batch, content, filePath);
    }
    
    console.log(`Extracted ${matches.length} functions from ${filePath}`);
  }

   /**
   * Process a batch of function matches
   */
   private async processFunctionBatch(
    matches: Parser.QueryMatch[], 
    content: string, 
    filePath: string
  ): Promise<void> {
    
      const functionIndexes = [];

      for (const match of matches) {
        // Get function node and name capture
        const functionCapture = match.captures.find(c => c.name === 'function');
        const nameCapture = match.captures.find(c => c.name === 'name');
        
        if (!functionCapture) continue;
        
        const funcNode = functionCapture.node;
        
        // Get function details
        const funcName = nameCapture ? nameCapture.node.text : '<anonymous>';

        functionIndexes.push({
          functionNode: funcNode,
          funcName,
          filePath,
        });


      }

      await this.indexFunctionsInBatch(functionIndexes);
        
  }


  // Public function to index a function by passing the function node
  public async indexFunction(
    functionNode: Parser.SyntaxNode,
    funcName: string,
    filePath: string
  ): Promise<string> {
  
    const startPosition = functionNode.startPosition;
    const endPosition = functionNode.endPosition;

    // Function source code (trimmed if too long)
    const sourceCode = functionNode.text.length > 1000 
      ? functionNode.text.substring(0, 1000) + '...' 
      : functionNode.text;

    // Generate unique ID
    const functionId = this.generateNodeId(
      'func', 
      funcName, 
      filePath, 
      startPosition.row, 
      startPosition.column
    );

    // Extract parameters
    const parameters = this.extractParameters(functionNode);

    // Index the function in Neo4j
    await this.dbClient.runInTransaction(async (session) => {
      // Create or update function node
      await session.run(`
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
      `, {
        functionId,
        funcName,
        lineStart: startPosition.row,
        lineEnd: endPosition.row,
        columnStart: startPosition.column,
        columnEnd: endPosition.column,
        parameters,
        sourceCode
      });

      // Create relationship to module
      const moduleId = `mod:${filePath}`;
      await session.run(`
        MATCH (f:${DbSchema.labels.FUNCTION} {id: $functionId})
        MATCH (m:${DbSchema.labels.MODULE} {id: $moduleId})
        MERGE (f)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
      `, { functionId, moduleId });
    });

    console.log(`Function indexed: ${funcName} in ${filePath}`);

    return functionId;
  }

  public async indexFunctionsInBatch(
    functionsData: { functionNode: Parser.SyntaxNode, funcName: string, filePath: string }[]
  ): Promise<void> {
    // Collect all the functions' indexing data into an array of parameters
    const functionsParams = functionsData.map(({ functionNode, funcName, filePath }) => {
      const startPosition = functionNode.startPosition;
      const endPosition = functionNode.endPosition;
  
      // Function source code (trimmed if too long)
      const sourceCode = functionNode.text.length > 1000 
        ? functionNode.text.substring(0, 1000) + '...' 
        : functionNode.text;
  
      // Generate unique ID
      const functionId = this.generateNodeId(
        'func', 
        funcName, 
        filePath, 
        startPosition.row, 
        startPosition.column
      );
  
      // Extract parameters
      const parameters = this.extractParameters(functionNode);
  
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
      };
    });
  
    // Execute all the indexing in a single transaction using UNWIND
    await this.dbClient.runInTransaction(async (session) => {
      // Create or update function nodes and relationships in bulk
      await session.run(`
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
      `, { functions: functionsParams });
  
      // Create relationships for each function to its module in bulk
      const moduleIds = functionsParams.map(f => `mod:${f.filePath}`);
      await session.run(`
        UNWIND $functions AS function
        MATCH (f:${DbSchema.labels.FUNCTION} {id: function.functionId})
        MATCH (m:${DbSchema.labels.MODULE}) 
        WHERE m.id IN $moduleIds
        MERGE (f)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
      `, { functions: functionsParams, moduleIds });
    });
  
    console.log(`Indexed ${functionsData.length} functions in batch.`);
  }

   /**
   * Get an indexed function by its unique ID from Neo4j
   */
   public async getFunctionById(functionId: string): Promise<any> {
    try {
      // Query to get the function from Neo4j by its unique ID
      const result = await this.dbClient.query(`
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
      `, { functionId });
  
      // Check if a function was found
      if (result.length === 0) {
        console.log(`Function with ID ${functionId} not found.`);
        return null; // Or you can throw an error if needed
      }
  
      // Return the function details from the query result
      return result[0];
  
    } catch (error) {
      console.error('Error retrieving function from Neo4j:', error);
      throw error; // Re-throw the error or return a custom error response
    }
   
  }


    /**
   * Extract parameter information from a function node
   */
    private extractParameters(funcNode: Parser.SyntaxNode): string[] {
        try {
          // Find parameters node (formal_parameters)
          const paramsNode = funcNode.children.find(child => 
            child.type === 'formal_parameters' || 
            child.type === 'parameter_list'
          );
          
          if (!paramsNode) return [];
          
          // Extract parameter names (skipping commas, etc.)
          return paramsNode.children
            .filter(child => child.type === 'identifier' || child.type === 'pattern')
            .map(child => child.text);
        } catch (error) {
          console.error('Error extracting parameters:', error);
          return [];
        }
      }




}