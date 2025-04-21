import Parser from 'tree-sitter';
import { Neo4jClient } from '../db/neo4j-client';
import { DbSchema } from '../db/schema';

export abstract class Extractor {
    constructor(protected dbClient: Neo4jClient) {}

    abstract extractClasses(filePath: string): any;

     /**
   * Generate a unique ID for a node within a file
   */
  protected generateNodeId(
    type: string, 
    name: string, 
    filePath: string, 
    line: number, 
    column: number
  ): string {
    // Create an ID that's unique and deterministic
    return `${type}:${filePath}:${name}:${line}:${column}`;
  }


  /**
   * Create a module node if it doesn't exist
   */
  protected async ensureModuleNode(filePath: string): Promise<void> {
    const moduleId = `mod:${filePath}`;
    const moduleName = filePath.split('/').pop() || '';
    
    await this.dbClient.query(`
      MERGE (m:${DbSchema.labels.MODULE} {id: $moduleId})
      ON CREATE SET 
        m.path = $filePath,
        m.name = $moduleName,
        m.createdAt = timestamp()
      ON MATCH SET
        m.updatedAt = timestamp()
    `, { moduleId, filePath, moduleName });
  }


  

}