import Parser from 'tree-sitter';
import { Extractor } from "./extractor";
import { Neo4jClient } from "../db/neo4j-client";

class ExportExtractor extends Extractor {

  constructor(dbClient: Neo4jClient) {
    super(dbClient);
  }

  /**
   * Extract exports from a parsed file and store in Neo4j
   */
  async extract(tree: Parser.Tree, content: string, filePath: string, query: Parser.Query): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath);

    // Create function query
    const matches = query.matches(tree.rootNode);

    // Process in batches
    const batchSize = 20;
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize);
      await this.processExportBatch(batch, content, filePath);
    }
    
    console.log(`Extracted ${matches.length} exports from ${filePath}`);

  }

  /**
   * Process a batch of export matches
   */
  private async processExportBatch(
    matches: Parser.QueryMatch[], 
    content: string, 
    filePath: string
  ): Promise<void> {
    await this.dbClient.runInTransaction(async (session) => {
      // for (const match of matches) {
      //   // Process different types of exports
      //   if (match.captures.some(c => c.name === 'named_export')) {
      //     await this.processNamedExport(match, filePath, session);
      //   } else if (match.captures.some(c => c.name === 'default_export')) {
      //     await this.processDefaultExport(match, filePath, session);
      //   } else if (match.captures.some(c => c.name === 'export_from')) {
      //     await this.processReExport(match, filePath, session);
      //   }
      // }
    });
  }



}