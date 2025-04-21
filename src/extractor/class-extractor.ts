
import Parser from 'tree-sitter';
import { Extractor } from './extractor';
import { Neo4jClient } from '../db/neo4j-client';
import { DbSchema } from '../db/schema';
import { createClassQuery } from '../queries/create-queries';
import { ClassQuery } from '../queries/js-query-constants';

export class ClassExtractor extends Extractor {
  constructor(dbClient: Neo4jClient) {
    super(dbClient);
  }
  /**
   * Extract classes from a parsed file and store in Neo4j
   */
  async extract(
    tree: Parser.Tree, 
    content: string, 
    filePath: string, 
    query: Parser.Query
  ): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath);
    
    const matches = query.matches(tree.rootNode);
    
    // Process in batches
    const batchSize = 20;
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize);
      await this.processClassBatch(batch, content, filePath);
    }
    
    console.log(`Extracted ${matches.length} classes from ${filePath}`);
  }
  
  /**
   * Process a batch of class matches
   */
  private async processClassBatch(
    matches: Parser.QueryMatch[], 
    content: string, 
    filePath: string
  ): Promise<void> {
    await this.dbClient.runInTransaction(async (session) => {
      for (const match of matches) {
        // Get class node and name capture
        const classCapture = match.captures.find(c => c.name === 'class' || c.name === 'class_expr');
        const nameCapture = match.captures.find(c => c.name === 'name');
        const constructorCapture = match.captures.find(c => c.name === 'constructor');
        
        if (!classCapture || !nameCapture) continue;
        
        const classNode = classCapture.node;
        
        // Get class details
        const className = nameCapture.node.text;
        const startPosition = classNode.startPosition;
        const endPosition = classNode.endPosition;
        
        // Extract superclass if present
        const superClass = this.extractSuperClass(classNode);
        
        // Extract implemented interfaces if present
        const interfaces = this.extractInterfaces(classNode);
        
        // Generate unique ID
        const classId = this.generateNodeId(
          'class', 
          className, 
          filePath, 
          startPosition.row, 
          startPosition.column
        );
        
        // Create class node
        await session.run(`
          MERGE (c:${DbSchema.labels.CLASS} {id: $classId})
          ON CREATE SET 
            c.name = $className,
            c.lineStart = $lineStart,
            c.lineEnd = $lineEnd,
            c.columnStart = $columnStart,
            c.columnEnd = $columnEnd,
            c.superClass = $superClass,
            c.interfaces = $interfaces,
            c.createdAt = timestamp()
          ON MATCH SET
            c.name = $className,
            c.lineStart = $lineStart,
            c.lineEnd = $lineEnd,
            c.columnStart = $columnStart,
            c.columnEnd = $columnEnd,
            c.superClass = $superClass,
            c.interfaces = $interfaces,
            c.updatedAt = timestamp()
        `, {
          classId,
          className,
          lineStart: startPosition.row,
          lineEnd: endPosition.row,
          columnStart: startPosition.column,
          columnEnd: endPosition.column,
          superClass,
          interfaces
        });
        
        // Create relationship to module
        const moduleId = `mod:${filePath}`;
        await session.run(`
          MATCH (c:${DbSchema.labels.CLASS} {id: $classId})
          MATCH (m:${DbSchema.labels.MODULE} {id: $moduleId})
          MERGE (c)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
        `, { classId, moduleId });

        
        // Extract and connect methods
        const methods = this.extractMethods(classNode);
        console.log("classId", classId)
 
        for (const method of methods) {
          // Generate method ID
          const methodId = this.generateNodeId(
            'method', 
            method.name, 
            filePath, 
            method.position.row, 
            method.position.column
          );

       
          
          // Create method node
          await session.run(`
            MERGE (f:${DbSchema.labels.FUNCTION} {id: $methodId})
            ON CREATE SET 
              f.name = $methodName,
              f.lineStart = $lineStart,
              f.lineEnd = $lineEnd,
              f.columnStart = $columnStart,
              f.columnEnd = $columnEnd,
              f.isMethod = true,
              f.isConstructor = $isConstructor,
              f.parameters = $parameters,
              f.createdAt = timestamp()
            ON MATCH SET
              f.name = $methodName,
              f.lineStart = $lineStart,
              f.lineEnd = $lineEnd,
              f.columnStart = $columnStart,
              f.columnEnd = $columnEnd,
              f.isMethod = true,
              f.isConstructor = $isConstructor,
              f.parameters = $parameters,
              f.updatedAt = timestamp()
          `, {
            methodId,
            methodName: method.name,
            lineStart: method.position.row,
            lineEnd: method.endPosition.row,
            columnStart: method.position.column,
            columnEnd: method.endPosition.column,
            isConstructor: method.name === 'constructor',
            parameters: method.parameters || []
          });
          
          // Create relationship between class and method
          await session.run(`
            MATCH (c:${DbSchema.labels.CLASS} {id: $classId})
            MATCH (f:${DbSchema.labels.FUNCTION} {id: $methodId})
            MERGE (c)-[:${DbSchema.relationships.HAS_METHOD}]->(f)
          `, { classId, methodId });
          
          // Create relationship between method and module
          await session.run(`
            MATCH (f:${DbSchema.labels.FUNCTION} {id: $methodId})
            MATCH (m:${DbSchema.labels.MODULE} {id: $moduleId})
            MERGE (f)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
          `, { methodId, moduleId });
        }
        
        // If there's a superclass, create EXTENDS relationship
        if (superClass) {
          // Note: This is a best-effort approach - the superclass may not be in the DB yet
          await session.run(`
            MATCH (c:${DbSchema.labels.CLASS} {id: $classId})
            MATCH (super:${DbSchema.labels.CLASS} {name: $superClass})
            MERGE (c)-[:${DbSchema.relationships.EXTENDS}]->(super)
          `, { classId, superClass });
        }
        
        // If there are interfaces, create IMPLEMENTS relationships
        for (const interfaceName of interfaces) {
          await session.run(`
            MATCH (c:${DbSchema.labels.CLASS} {id: $classId})
            MERGE (i:Interface {name: $interfaceName})
            MERGE (c)-[:${DbSchema.relationships.IMPLEMENTS}]->(i)
          `, { classId, interfaceName });
        }
      }
    });

}

 /**
   * Extract superclass name from a class node
   */
 private extractSuperClass(classNode: Parser.SyntaxNode): string | null {
    try {
      // Find extends clause
      const extendsNode = classNode.children.find(child => 
        child.type === 'extends_clause' || 
        child.type === 'class_heritage'
      );
      
      if (!extendsNode) return null;
      
      // Get superclass identifier
      const identifierNode = extendsNode.children.find(child => 
        child.type === 'identifier' ||
        child.type === 'member_expression'
      );
      
      return identifierNode ? identifierNode.text : null;
    } catch (error) {
      console.error('Error extracting superclass:', error);
      return null;
    }
  }


   /**
   * Extract implemented interfaces from a class node
   */
   private extractInterfaces(classNode: Parser.SyntaxNode): string[] {
    try {
      // Find implements clause
      const implementsNode = classNode.children.find(child => 
        child.type === 'implements_clause'
      );
      
      if (!implementsNode) return [];
      
      // Get interface identifiers
      const interfaces: string[] = [];
      
      for (const child of implementsNode.children) {
        if (child.type === 'identifier' || child.type === 'member_expression') {
          interfaces.push(child.text);
        }
      }
      
      return interfaces;
    } catch (error) {
      console.error('Error extracting interfaces:', error);
      return [];
    }
  }

   /**
   * Extract methods from a class node
   */
   private extractMethods(classNode: Parser.SyntaxNode): Array<{
    name: string;
    position: Parser.Point;
    endPosition: Parser.Point;
    parameters?: string[];
  }> {
    try {
      const methods: Array<{
        name: string;
        position: Parser.Point;
        endPosition: Parser.Point;
        parameters?: string[];
      }> = [];
      
      // Find class body
      const bodyNode = classNode.children.find(child => 
        child.type === 'class_body'
      );
      
      if (!bodyNode) return [];
      
      // Iterate through class body children
      for (const child of bodyNode.children) {
        if (child.type === 'method_definition') {
          // Get method name
          const nameNode = child.children.find(n => 
            n.type === 'property_identifier'
          );
          
          if (!nameNode) continue;
          
          // Extract parameters
          const paramsNode = child.children.find(n => 
            n.type === 'formal_parameters' || 
            n.type === 'parameter_list'
          );
          
          let parameters: string[] = [];
          
          if (paramsNode) {
            parameters = paramsNode.children
              .filter(p => p.type === 'identifier' || p.type === 'pattern')
              .map(p => p.text);
          }
          
          methods.push({
            name: nameNode.text,
            position: nameNode.startPosition,
            endPosition: child.endPosition,
            parameters
          });
        }
      }
      
      return methods;
    } catch (error) {
      console.error('Error extracting methods:', error);
      return [];
    }
  }



    
  }