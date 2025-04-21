import Parser from 'tree-sitter';
import { Extractor } from './extractor';
import { Neo4jClient } from '../db/neo4j-client';
import { DbSchema } from '../db/schema';
import { createFunctionQuery } from '../queries/create-queries';
import { FunctionQuery } from '../queries/js-query-constants';

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
  //  const query = createFunctionQuery(tree.getLanguage(), FunctionQuery);
    const matches = query.matches(tree.rootNode);

    console.log('matches', matches)
    
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
    await this.dbClient.runInTransaction(async (session) => {
      for (const match of matches) {
        // Get function node and name capture
        const functionCapture = match.captures.find(c => c.name === 'function');
        const nameCapture = match.captures.find(c => c.name === 'name');
        
        if (!functionCapture) continue;
        
        const funcNode = functionCapture.node;
        
        // Get function details
        const funcName = nameCapture ? nameCapture.node.text : '<anonymous>';
        const startPosition = funcNode.startPosition;
        const endPosition = funcNode.endPosition;
        const funcText = content.substring(
          content.indexOf('\n', 0) === 0 ? 0 : content.indexOf('\n', 0) + 1, 
          funcNode.endIndex
        );
        
        // Function source code (trimmed if too long)
        const sourceCode = funcNode.text.length > 1000 
          ? funcNode.text.substring(0, 1000) + '...' 
          : funcNode.text;
        
        // Generate unique ID
        const functionId = this.generateNodeId(
          'func', 
          funcName, 
          filePath, 
          startPosition.row, 
          startPosition.column
        );
        
        // Extract parameters
        const parameters = this.extractParameters(funcNode);
        
        // Create function node
        await session.run(`
          MERGE (f:${DbSchema.labels.FUNCTION} {id: $functionId})
          ON CREATE SET 
            f.name = $funcName,
            f.lineStart = $lineStart,
            f.lineEnd = $lineEnd,
            f.columnStart = $columnStart,
            f.columnEnd = $columnEnd,
            f.parameters = $parameters,
            f.sourceCode = $sourceCode,
            f.createdAt = timestamp()
          ON MATCH SET
            f.name = $funcName,
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
      }
    });
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