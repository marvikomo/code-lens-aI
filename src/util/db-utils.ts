// src/utils/db-utils.ts
import { Neo4jClient } from '../db/neo4j-client';
import { DbSchema } from '../db/schema';

export class DbUtils {

    constructor(private dbClient: Neo4jClient) {}

  /**
   * Generate a unique ID for a node within a file
   */
  public generateNodeId(
    type: string,
    name: string,
    filePath: string,
    line: number,
    column: number,
  ): string {
    // Create an ID that's unique and deterministic
    return `${type}:${filePath}:${name}:${line}:${column}`
  }

    /**
   * Create a module node if it doesn't exist
   */
    public async ensureModuleNode(filePath: string): Promise<void> {
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
