import { Neo4jClient } from '../db/neo4j-client'
import { DbSchema } from '../db/schema'
import Parser from 'tree-sitter'
import { DbUtils } from '../util/db-utils'

export class ClassNodeService {
  private dbClient: Neo4jClient
  private dbUtils: DbUtils

  constructor(dbClient: Neo4jClient) {
    this.dbClient = dbClient
    this.dbUtils = new DbUtils(dbClient)
  }

  /**
   * Index a batch of classes
   * This method can be called externally
   */
  public async indexClassesInBatch(
    classData: Array<{
      classNode: Parser.SyntaxNode
      className: string
      filePath: string
    }>,
    content: string,
  ): Promise<void> {
    const classParams = classData.map((data) => {
      const startPosition = data.classNode.startPosition
      const endPosition = data.classNode.endPosition

      // Extract superclass if present
      const superClass = this.extractSuperClass(data.classNode)

      // Extract implemented interfaces if present
      const interfaces = this.extractInterfaces(data.classNode)

      // Generate unique ID
      const classId = this.dbUtils.generateNodeId(
        'class',
        data.className,
        data.filePath,
        startPosition.row,
        startPosition.column,
      )

      return {
        classId,
        className: data.className,
        lineStart: startPosition.row,
        lineEnd: endPosition.row,
        columnStart: startPosition.column,
        columnEnd: endPosition.column,
        superClass,
        interfaces,
        filePath: data.filePath,
      }
    })

    // Prepare method parameters for bulk operation
    const allMethodParams = []
    const classMethodRelations = []

    for (let i = 0; i < classData.length; i++) {
      const data = classData[i]
      const classParam = classParams[i]

      // Extract methods for this class
      const methods = this.extractMethods(data.classNode, content)

      for (const method of methods) {
        // Generate method ID
        const methodId = this.dbUtils.generateNodeId(
          'func',
          method.name,
          data.filePath,
          method.position.row,
          method.position.column,
        )

        allMethodParams.push({
          methodId,
          methodName: method.name,
          methodFullName: `${data.className}.${method.name}`,
          lineStart: method.position.row,
          lineEnd: method.endPosition.row,
          columnStart: method.position.column,
          columnEnd: method.endPosition.column,
          isConstructor: method.name === 'constructor',
          parameters: method.parameters || [],
          sourceCode: method.source,
          filePath: data.filePath,
        })

        classMethodRelations.push({
          classId: classParam.classId,
          methodId,
        })
      }
    }
    // 1. Create or update all class nodes in bulk
    await this.dbClient.runInTransaction(async (session) => {
      await session.run(
        `
              UNWIND $classes AS class
              MERGE (c:${DbSchema.labels.CLASS} {id: class.classId})
              ON CREATE SET 
                c.name = class.className,
                c.lineStart = class.lineStart,
                c.lineEnd = class.lineEnd,
                c.columnStart = class.columnStart,
                c.columnEnd = class.columnEnd,
                c.superClass = class.superClass,
                c.interfaces = class.interfaces,
                c.createdAt = timestamp()
              ON MATCH SET
                c.name = class.className,
                c.lineStart = class.lineStart,
                c.lineEnd = class.lineEnd,
                c.columnStart = class.columnStart,
                c.columnEnd = class.columnEnd,
                c.superClass = class.superClass,
                c.interfaces = class.interfaces,
                c.updatedAt = timestamp()
            `,
        { classes: classParams },
      )

      // 2. Create relationships to modules in bulk
      await session.run(
        `
            UNWIND $classes AS class
            MATCH (c:${DbSchema.labels.CLASS} {id: class.classId})
            MATCH (m:${DbSchema.labels.MODULE} {id: 'mod:' + class.filePath})
            MERGE (c)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
          `,
        { classes: classParams },
      )

      // 3. Create or update all method nodes in bulk
      if (allMethodParams.length > 0) {
        await session.run(
          `
              UNWIND $methods AS method
              MERGE (f:${DbSchema.labels.FUNCTION} {id: method.methodId})
              ON CREATE SET 
                f.name = method.methodName,
                f.fullName = method.methodFullName,
                f.lineStart = method.lineStart,
                f.lineEnd = method.lineEnd,
                f.columnStart = method.columnStart,
                f.columnEnd = method.columnEnd,
                f.sourceCode = method.sourceCode,
                f.isMethod = true,
                f.isConstructor = method.isConstructor,
                f.parameters = method.parameters,
                f.createdAt = timestamp()
              ON MATCH SET
                f.name = method.methodName,
                f.fullName = method.methodFullName,
                f.lineStart = method.lineStart,
                f.lineEnd = method.lineEnd,
                f.columnStart = method.columnStart,
                f.columnEnd = method.columnEnd,
                f.sourceCode = method.sourceCode,
                f.isMethod = true,
                f.isConstructor = method.isConstructor,
                f.parameters = method.parameters,
                f.updatedAt = timestamp()
            `,
          { methods: allMethodParams },
        )

        // 4. Create relationships between classes and methods in bulk
        await session.run(
          `
              UNWIND $relations AS relation
              MATCH (c:${DbSchema.labels.CLASS} {id: relation.classId})
              MATCH (f:${DbSchema.labels.FUNCTION} {id: relation.methodId})
              MERGE (c)-[:${DbSchema.relationships.HAS_METHOD}]->(f)
            `,
          { relations: classMethodRelations },
        )

        // 5. Create relationships between methods and modules in bulk
        await session.run(
          `
              UNWIND $methods AS method
              MATCH (f:${DbSchema.labels.FUNCTION} {id: method.methodId})
              MATCH (m:${DbSchema.labels.MODULE} {id: 'mod:' + method.filePath})
              MERGE (f)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
            `,
          { methods: allMethodParams },
        )
      }

      // 6. Create EXTENDS relationships for classes with superclasses
      const classesWithSuperclass = classParams.filter((c) => c.superClass)
      if (classesWithSuperclass.length > 0) {
        await session.run(
          `
            UNWIND $classes AS class
            MATCH (c:${DbSchema.labels.CLASS} {id: class.classId})
            MATCH (super:${DbSchema.labels.CLASS} {name: class.superClass})
            MERGE (c)-[:${DbSchema.relationships.EXTENDS}]->(super)
          `,
          { classes: classesWithSuperclass },
        )
      }

      // 7. Create IMPLEMENTS relationships for interfaces
      const interfaceRelations = []
      for (const classParam of classParams) {
        for (const interfaceName of classParam.interfaces || []) {
          interfaceRelations.push({
            classId: classParam.classId,
            interfaceName,
          })
        }
      }

      if (interfaceRelations.length > 0) {
        await session.run(
          `
              UNWIND $relations AS relation
              MATCH (c:${DbSchema.labels.CLASS} {id: relation.classId})
              MERGE (i:Interface {name: relation.interfaceName})
              MERGE (c)-[:${DbSchema.relationships.IMPLEMENTS}]->(i)
             `,
          { relations: interfaceRelations },
        )
      }

      console.log(
        `Indexed ${classParams.length} classes with ${allMethodParams.length} methods in batch.`,
      )
    })
  }

  /**
   * Extract superclass name from a class node
   */
  private extractSuperClass(classNode: Parser.SyntaxNode): string | null {
    try {
      // Find extends clause
      const extendsNode = classNode.children.find(
        (child) =>
          child.type === 'extends_clause' || child.type === 'class_heritage',
      )

      if (!extendsNode) return null

      // Get superclass identifier
      const identifierNode = extendsNode.children.find(
        (child) =>
          child.type === 'identifier' || child.type === 'member_expression',
      )

      return identifierNode ? identifierNode.text : null
    } catch (error) {
      console.error('Error extracting superclass:', error)
      return null
    }
  }

  /**
   * Extract implemented interfaces from a class node
   */
  private extractInterfaces(classNode: Parser.SyntaxNode): string[] {
    try {
      // Find implements clause
      const implementsNode = classNode.children.find(
        (child) => child.type === 'implements_clause',
      )

      if (!implementsNode) return []

      // Get interface identifiers
      const interfaces: string[] = []

      for (const child of implementsNode.children) {
        if (child.type === 'identifier' || child.type === 'member_expression') {
          interfaces.push(child.text)
        }
      }

      return interfaces
    } catch (error) {
      console.error('Error extracting interfaces:', error)
      return []
    }
  }
  /**
   * Extract methods from a class node
   */
  private extractMethods(
    classNode: Parser.SyntaxNode,
    fileContent: string,
  ): Array<{
    name: string
    position: Parser.Point
    endPosition: Parser.Point
    parameters?: string[]
    source: string
  }> {
    try {
      const methods: Array<{
        name: string
        position: Parser.Point
        endPosition: Parser.Point
        parameters?: string[]
        source: string
      }> = []

      // Find class body
      const bodyNode = classNode.children.find(
        (child) => child.type === 'class_body',
      )

      if (!bodyNode) return []

      // Iterate through class body children
      for (const child of bodyNode.children) {
        if (child.type === 'method_definition') {
          // Get method name
          const nameNode = child.children.find(
            (n) => n.type === 'property_identifier',
          )

          if (!nameNode) continue

          // Extract parameters
          const paramsNode = child.children.find(
            (n) =>
              n.type === 'formal_parameters' || n.type === 'parameter_list',
          )

          let parameters: string[] = []

          if (paramsNode) {
            parameters = paramsNode.children
              .filter((p) => p.type === 'identifier' || p.type === 'pattern')
              .map((p) => p.text)
          }

          const source = fileContent.slice(child.startIndex, child.endIndex)

          methods.push({
            name: nameNode.text,
            position: nameNode.startPosition,
            endPosition: child.endPosition,
            parameters,
            source,
          })
        }
      }

      return methods
    } catch (error) {
      console.error('Error extracting methods:', error)
      return []
    }
  }

  /**
 * Search for classes matching specified criteria
 * Returns classes that match ANY of the provided criteria
 */
public async searchClasses(searchParams: {
    name?: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    superClass?: string;
    implements?: string;
    limit?: number;
  }): Promise<any[]> {
    try {
      const { 
        name, 
        filePath,
        superClass,
        implements: interfaceName
      } = searchParams;
      
      // Convert numeric parameters to integers explicitly
      const startLine = searchParams.startLine !== undefined ? parseInt(String(searchParams.startLine), 10) : undefined;
      const endLine = searchParams.endLine !== undefined ? parseInt(String(searchParams.endLine), 10) : undefined;
      const limit = searchParams.limit !== undefined ? parseInt(String(searchParams.limit), 10) : 10;
      
      // Build the query with file path matching if provided
      let query = filePath 
        ? `MATCH (c:${DbSchema.labels.CLASS})-[:${DbSchema.relationships.DEFINED_IN}]->(m:${DbSchema.labels.MODULE} {id: $moduleId})`
        : `MATCH (c:${DbSchema.labels.CLASS})`;
      
      const queryParams: Record<string, any> = {};
      if (filePath) {
        queryParams.moduleId = `mod:${filePath}`;
      }
      
      // Build individual criteria for WHERE clause
      const criteria: string[] = [];
      
      if (name) {
        criteria.push(`c.name CONTAINS $name`);
        queryParams.name = name;
      }
      
      if (superClass) {
        criteria.push(`c.superClass = $superClass`);
        queryParams.superClass = superClass;
      }
      
      if (interfaceName) {
        // For interface matching, we need to check the 'interfaces' array property
        criteria.push(`ANY(interface IN c.interfaces WHERE interface CONTAINS $interfaceName)`);
        queryParams.interfaceName = interfaceName;
      }
      
      if (startLine !== undefined) {
        criteria.push(`(c.lineStart <= $startLine AND c.lineEnd >= $startLine)`);
        queryParams.startLine = startLine;
      }
      
      if (endLine !== undefined) {
        criteria.push(`(c.lineStart <= $endLine AND c.lineEnd >= $endLine)`);
        queryParams.endLine = endLine;
      }
      
      // Add WHERE clause if we have any criteria
      if (criteria.length > 0) {
        // Use OR between criteria - match if ANY criterion matches
        query += ` WHERE ${criteria.join(' OR ')}`;
      }
      
      // Add return clause
      query += `
        RETURN c.id AS classId, 
               c.name AS className, 
               c.lineStart AS lineStart, 
               c.lineEnd AS lineEnd, 
               c.columnStart AS columnStart, 
               c.columnEnd AS columnEnd, 
               c.superClass AS superClass, 
               c.interfaces AS interfaces
        ${filePath ? ', m.path AS filePath' : ''}
        ORDER BY c.lineStart ASC
      `;
      
      // Add LIMIT clause directly in the query
      query += ` LIMIT 1`;
      
      // Execute the query
      const results = await this.dbClient.query(query, queryParams);
      
      // For each class, fetch its methods
      for (const classResult of results) {
        const methodsQuery = `
          MATCH (c:${DbSchema.labels.CLASS} {id: $classId})-[:${DbSchema.relationships.HAS_METHOD}]->(m:${DbSchema.labels.FUNCTION})
          RETURN m.id AS methodId, 
                 m.name AS methodName,
                 m.fullName AS methodFullName,
                 m.lineStart AS lineStart,
                 m.lineEnd AS lineEnd,
                 m.isConstructor AS isConstructor,
                 m.parameters AS parameters
          ORDER BY m.lineStart ASC
        `;
        
        const methods = await this.dbClient.query(methodsQuery, { classId: classResult.classId });
        classResult.methods = methods;
      }
      
      return results;
    } catch (error) {
      console.error('Error searching classes from Neo4j:', error);
      throw error;
    }
  }
}
