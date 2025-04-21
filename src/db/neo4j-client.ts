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