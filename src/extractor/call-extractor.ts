
import Parser from 'tree-sitter';
import { Extractor } from './extractor';
import { Neo4jClient } from '../db/neo4j-client';
import { DbSchema } from '../db/schema';
import { logger } from '../logger';

export class CallExtractor extends Extractor {
  constructor(dbClient: Neo4jClient) {
    super(dbClient);
  }
  

   /**
   * Extract function calls from a parsed file and store in Neo4j
   */
   async extract(
    tree: Parser.Tree, 
    content: string, 
    filePath: string, 
    query: Parser.Query
  ): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath);
    
    // Get all call expressions
    const matches = query.matches(tree.rootNode);
    
    logger.writeResults(matches, "call-matches");
    
    // Process in batches
    const batchSize = 20;
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize);
      await this.processCallBatch(batch, content, filePath);
    }
    
    console.log(`Extracted ${matches.length} calls from ${filePath}`);
  }

   /**
   * Process a batch of call matches
   */
   private async processCallBatch(
    matches: Parser.QueryMatch[],
    content: string,
    filePath: string
  ): Promise<void> {
    await this.dbClient.runInTransaction(async (session) => {

        for (const match of matches) {
          // Handle different types of calls
          if (match.captures.some(c => c.name === 'call')) {
           
          } 
          
        }
      });


  }

}