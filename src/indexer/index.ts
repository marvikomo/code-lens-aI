import { Graph } from 'graphlib'
import { GraphUtil } from '../util/graph-utils'
import neo4j, { Driver, Session } from 'neo4j-driver'

export interface Neo4jConfig {
  uri: string
  username: string
  password: string
}

export class Indexer {
  private driver: Driver

  constructor(config: Neo4jConfig) {
    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password),
    )
  }

  async indexGraph(graph: Graph): Promise<void> {
    const session = this.driver.session()

    try {
      console.log('🚀 Starting optimized batch indexing...')

      // Batch index all nodes first with automatic NODE labeling
      await this.batchIndexNodes(session, graph)

      // Create unified vector index on NODE base label
      await this.createUnifiedVectorIndex()

      // Batch create relationships
      await this.batchIndexRelationships(session, graph)

      console.log('✅ Batch indexing complete')
    } finally {
      await session.close()
    }
  }

  /**
   * Create unified vector index on NODE base label
   */
  private async createUnifiedVectorIndex(): Promise<void> {
    const session = this.driver.session()
    
    try {
      console.log('📊 Creating unified vector index on NODE base label...')
      
      await session.run(`
        CREATE VECTOR INDEX unified_node_embeddings FOR (n:NODE) ON (n.embedding)
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: 384,
          \`vector.similarity_function\`: 'cosine'
        }}
      `)
      
      // Also create supporting indexes
      await session.run('CREATE INDEX node_types FOR (n:NODE) ON (n.type)')
      await session.run('CREATE INDEX node_names FOR (n:NODE) ON (n.name)')
      
      console.log('✅ Vector and supporting indexes created')
    } catch (error) {
      console.log('💡 Indexes may already exist:', error.message)
    } finally {
      await session.close()
    }
  }

  /**
   * Batch create nodes with automatic NODE base labeling
   */
  private async batchIndexNodes(session: Session, graph: Graph): Promise<void> {
    const nodes = graph.nodes()
    const BATCH_SIZE = 1000 // Reduced for vector operations

    console.log(
      `📦 Batching ${nodes.length} nodes with NODE labeling in chunks of ${BATCH_SIZE}...`,
    )

    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      const batch = nodes.slice(i, i + BATCH_SIZE)
      const nodeData = batch.map((nodeId) => ({
        nodeId,
        ...graph.node(nodeId),
      }))

      await this.createNodesBatchWithAutoLabeling(session, nodeData)
      console.log(
        `✅ Processed nodes ${i + 1}-${Math.min(i + BATCH_SIZE, nodes.length)}`,
      )
    }
  }

  /**
   * Create multiple nodes with automatic NODE + specific type labeling
   */
  private async createNodesBatchWithAutoLabeling(
    session: Session,
    nodeDataArray: any[],
  ): Promise<void> {
    const tx = session.beginTransaction()

    try {
      // Group nodes by type for more efficient batch operations
      const nodesByType = this.groupNodesByType(nodeDataArray)
      
      for (const [nodeType, nodes] of Object.entries(nodesByType)) {
        await this.createNodesOfTypeBatch(tx, nodeType, nodes)
      }

      await tx.commit()
    } catch (error) {
      await tx.rollback()
      throw error
    }
  }

  /**
   * Group nodes by their type for batch processing
   */
  private groupNodesByType(nodeDataArray: any[]): Record<string, any[]> {
    return nodeDataArray.reduce((acc, nodeData) => {
      const type = this.capitalizeFirst(nodeData.type || 'Unknown')
      if (!acc[type]) {
        acc[type] = []
      }
      acc[type].push(nodeData)
      return acc
    }, {} as Record<string, any[]>)
  }

  /**
   * Create nodes of a specific type with NODE base label
   */
  private async createNodesOfTypeBatch(
    tx: any,
    nodeType: string,
    nodes: any[]
  ): Promise<void> {
    // Prepare node data for batch creation
    const batchData = nodes.map(nodeData => {
      const { nodeId, type, embedding, ...properties } = nodeData

      const validProperties = Object.entries(properties).reduce(
        (acc, [key, value]) => {
          if (
            value !== undefined &&
            value !== null &&
            value !== '' &&
            !Array.isArray(value) &&
            typeof value !== 'object'
          ) {
            acc[key] = value
          }
          return acc
        },
        {} as any,
      )

      return {
        nodeId,
        embedding: embedding && Array.isArray(embedding) && embedding.length > 0 ? embedding : null,
        properties: validProperties
      }
    })

    // Create Cypher query with NODE + specific type labels
    const labels = `:NODE:${nodeType}`
    
    const cypher = `
      UNWIND $batchData as item
      MERGE (n${labels} {id: item.nodeId})
      SET n += item.properties
      ${batchData.some(item => item.embedding) ? 'SET n.embedding = CASE WHEN item.embedding IS NOT NULL THEN item.embedding ELSE n.embedding END' : ''}
    `

    await tx.run(cypher, { batchData })
    
    console.log(`📝 Created ${nodes.length} nodes with labels NODE:${nodeType}`)
  }

  // Rest of your existing methods remain the same...
  private async batchIndexRelationships(
    session: Session,
    graph: Graph,
  ): Promise<void> {
    const edges = graph.edges()
    const BATCH_SIZE = 100

    console.log(
      `🔗 Batching ${edges.length} relationships in chunks of ${BATCH_SIZE}...`,
    )

    for (let i = 0; i < edges.length; i += BATCH_SIZE) {
      const batch = edges.slice(i, i + BATCH_SIZE)
      await this.createRelationshipsBatch(session, batch, graph)
      console.log(
        `✅ Processed relationships ${i + 1}-${Math.min(
          i + BATCH_SIZE,
          edges.length,
        )}`,
      )
    }
  }

  private async createRelationshipsBatch(
    session: Session,
    edges: any[],
    graph: Graph,
  ): Promise<void> {
    const tx = session.beginTransaction()

    try {
      const relationshipData = edges.map((edge) => {
        const edgeData = graph.edge(edge)
        const relationshipType = this.formatRelationshipType(
          edgeData?.type || 'RELATED_TO',
        )

        return {
          fromId: edge.v,
          toId: edge.w,
          relType: relationshipType,
        }
      })

      const cypher = `
        UNWIND $relationships as rel
        MATCH (from:NODE {id: rel.fromId})
        MATCH (to:NODE {id: rel.toId})
        CALL apoc.merge.relationship(from, rel.relType, {}, {}, to) YIELD rel as relationship
        RETURN count(relationship)
      `

      try {
        await tx.run(cypher, { relationships: relationshipData })
      } catch (error) {
        // Fallback to individual relationship creation
        for (const rel of relationshipData) {
          await tx.run(
            `
            MATCH (from:NODE {id: $fromId})
            MATCH (to:NODE {id: $toId})
            MERGE (from)-[:\`${rel.relType}\`]->(to)
          `,
            { fromId: rel.fromId, toId: rel.toId },
          )
        }
      }

      await tx.commit()
    } catch (error) {
      await tx.rollback()
      throw error
    }
  }

  private formatRelationshipType(type: string): string {
    return type.toUpperCase().replace(/\s+/g, '_')
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Query methods for the unified NODE structure
   */
  async searchSimilarNodes(
    queryVector: number[], 
    limit: number = 10,
    nodeTypes?: string[]
  ): Promise<any[]> {
    const session = this.driver.session()
    
    try {
      let cypher = `
        CALL db.index.vector.queryNodes('unified_node_embeddings', $limit, $queryVector)
        YIELD node, score
      `
      
      const params: any = { limit, queryVector }
      
      if (nodeTypes && nodeTypes.length > 0) {
        const typeConditions = nodeTypes.map(type => `node:${this.capitalizeFirst(type)}`).join(' OR ')
        cypher += ` WHERE ${typeConditions}`
      }
      
      cypher += `
        RETURN node, score, 
               [label IN labels(node) WHERE label <> 'NODE'][0] as nodeType
        ORDER BY score DESC
      `
      
      const result = await session.run(cypher, params)
      
      return result.records.map(record => ({
        node: record.get('node').properties,
        score: record.get('score'),
        nodeType: record.get('nodeType')
      }))
      
    } finally {
      await session.close()
    }
  }

  async getNodesByType(nodeType: string): Promise<any[]> {
    const session = this.driver.session()
    
    try {
      const result = await session.run(
        `MATCH (n:NODE:${this.capitalizeFirst(nodeType)}) RETURN n LIMIT 100`
      )
      
      return result.records.map(record => record.get('n').properties)
    } finally {
      await session.close()
    }
  }

  async validateNodeLabeling(): Promise<void> {
    const session = this.driver.session()
    
    try {
      // Check that all nodes have NODE label
      const result = await session.run(`
        MATCH (n) 
        WHERE NOT n:NODE 
        RETURN count(n) as nodesWithoutBaseLabel
      `)
      
      const count = result.records[0].get('nodesWithoutBaseLabel').toNumber()
      
      if (count > 0) {
        console.warn(`⚠️  Found ${count} nodes without NODE base label`)
      } else {
        console.log('✅ All nodes have proper NODE base labeling')
      }
      
      // Show label distribution
      const labelResult = await session.run(`
        MATCH (n:NODE)
        UNWIND labels(n) as label
        WHERE label <> 'NODE'
        RETURN label as nodeType, count(*) as count
        ORDER BY count DESC
      `)
      
      console.log('📊 Node type distribution:')
      labelResult.records.forEach(record => {
        console.log(`  ${record.get('nodeType')}: ${record.get('count')}`)
      })
      
    } finally {
      await session.close()
    }
  }
}