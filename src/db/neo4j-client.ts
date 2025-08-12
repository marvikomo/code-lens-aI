import neo4j, { Driver, Session, Result } from 'neo4j-driver';
import { DbSchema } from './schema';

export class Neo4jClient {
  private driver: Driver | null = null;
  
  constructor(
    private uri: string,
    private username: string,
    private password: string
  ) {}
  
  /**
   * Initialize the Neo4j connection and set up schema
   */
  async initialize(): Promise<void> {
    this.driver = neo4j.driver(
      this.uri, 
      neo4j.auth.basic(this.username, this.password),
      { maxConnectionPoolSize: 50 }
    );
    
    // Test connection
    try {
      const session = this.getSession();
      await session.run('RETURN 1 as test');
      session.close();
      console.log('Connected to Neo4j successfully');
      
      // Initialize schema (indexes and constraints)
      await this.initializeSchema();
    } catch (error) {
      console.error('Failed to connect to Neo4j:', error);
      throw error;
    }
  }
   /**
   * Initialize database schema (constraints and indexes)
   */
   private async initializeSchema(): Promise<void> {
    const session = this.getSession();
    
    try {
      for (const constraint of DbSchema.constraints) {
        await session.run(constraint);
      }
      
      for (const index of DbSchema.indices) {
        await session.run(index);
      }
      
      console.log('Database schema initialized');
    } catch (error) {
      console.error('Error initializing schema:', error);
      throw error;
    } finally {
      session.close();
    }
  }
  
  /**
   * Get a new session
   */
  getSession(): Session {
    if (!this.driver) {
      throw new Error('Neo4j driver not initialized');
    }
    return this.driver.session();
  }
  
  /**
   * Run a query and return the results
   */
  async query(cypher: string, params: Record<string, any> = {}): Promise<any[]> {
    const session = this.getSession();
  
    try {
      const result = await session.run(cypher, params);
      return result.records.map(record => {
        const obj: Record<string, any> = {};
        for (const key of record.keys) {
          if (typeof key === 'string') {
            obj[key] = record.get(key);
          }
        }
        return obj;
      });
    } finally {
      session.close();
    }
  }
  /**
   * Run a query within a transaction
   */
  async runInTransaction(callback: (session: Session) => Promise<void>): Promise<void> {
    const session = this.getSession();
    const tx = session.beginTransaction();
    
    try {
      await callback(tx as unknown as Session);
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      session.close();
    }
  }

  async getDriver(): Promise<Driver> {
    if (!this.driver) {
      throw new Error('Neo4j driver not initialized');
    }
    return this.driver;
  }


  /**
 * Get the graph schema including labels, relationships, properties, constraints, and indexes
 */
async getSchema(): Promise<{
  labels: string[];
  relationshipTypes: string[];
  propertyKeys: string[];
  constraints: any[];
  indexes: any[];
  relationshipPatterns: string[];
}> {
  const session = this.getSession();
  
  try {
    // Get all node labels
    const labelsResult = await session.run('CALL db.labels()');
    const labels = labelsResult.records.map(record => record.get('label'));
    
    // Get all relationship types
    const relationshipTypesResult = await session.run('CALL db.relationshipTypes()');
    const relationshipTypes = relationshipTypesResult.records.map(record => record.get('relationshipType'));
    
    // Get all property keys
    const propertyKeysResult = await session.run('CALL db.propertyKeys()');
    const propertyKeys = propertyKeysResult.records.map(record => record.get('propertyKey'));
    
    // Get constraints
    const constraintsResult = await session.run('SHOW CONSTRAINTS');
    const constraints = constraintsResult.records.map(record => ({
      name: record.get('name'),
      type: record.get('type'),
      entityType: record.get('entityType'),
      labelsOrTypes: record.get('labelsOrTypes'),
      properties: record.get('properties')
    }));
    
    // Get indexes
    const indexesResult = await session.run('SHOW INDEXES');
    const indexes = indexesResult.records.map(record => ({
      name: record.get('name'),
      type: record.get('type'),
      entityType: record.get('entityType'),
      labelsOrTypes: record.get('labelsOrTypes'),
      properties: record.get('properties'),
      state: record.get('state')
    }));
    
    // Get relationship patterns from actual data
    const relationshipPatternsResult = await session.run(`
      MATCH (n)-[r]->(m)
      RETURN DISTINCT 
        labels(n) as sourceLabels, 
        type(r) as relationshipType, 
        labels(m) as targetLabels
      ORDER BY sourceLabels, relationshipType, targetLabels
    `);
    
    const relationshipPatterns = relationshipPatternsResult.records.map(record => {
      const sourceLabels = record.get('sourceLabels');
      const relationshipType = record.get('relationshipType');
      const targetLabels = record.get('targetLabels');
      
      const source = sourceLabels.length > 0 ? `:${sourceLabels.join(':')}` : '';
      const target = targetLabels.length > 0 ? `:${targetLabels.join(':')}` : '';
      
      return `(${source})-[:${relationshipType}]->(${target})`;
    });

    return {
      labels,
      relationshipTypes,
      propertyKeys,
      constraints,
      indexes,
      relationshipPatterns
    };
  } finally {
    session.close();
  }
}
  
  /**
   * Close the Neo4j driver
   */
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }
  
  /**
   * Clear all data (use with caution!)
   */
  async clearDatabase(): Promise<void> {
    const session = this.getSession();
    try {
      await session.run('MATCH (n) DETACH DELETE n');
      console.log('Database cleared');
    } finally {
      session.close();
    }
  }
}