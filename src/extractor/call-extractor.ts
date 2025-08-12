
import Parser from 'tree-sitter';
import { Extractor } from './extractor';
import { Neo4jClient } from '../db/neo4j-client';
import { DbSchema } from '../db/schema';
import { logger } from '../logger';
import { TreeSitterUtil } from '../util/tree-sitter-util';
import { CodeVectorStore } from '../vector-store';
import { Graph } from 'graphlib';

interface CallInfo {
    id: string;
    callNode: Parser.SyntaxNode;
    callerInfo: { id: string; name: string } | null;
    calleeName: string;
    objectName?: string;      // For method calls
    methodName?: string;      // For method calls
    filePath: string;
    argsCount: number;
    isTopLevel: boolean;
    callType: 'direct' | 'method' | 'nested' | 'iife' | 'toplevel';
  }

export class CallExtractor extends Extractor {
    // Cache for function identifications to avoid repeated DB lookups
    private functionCache: Map<string, { id: string; name: string }> = new Map();
    
      constructor(dbClient: Neo4jClient, treeSitterUtil: TreeSitterUtil, vectorStore: CodeVectorStore, graph: Graph) {
      super(dbClient, treeSitterUtil, vectorStore, graph);
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
      //console.log(`Extracting calls from ${filePath}`);
      
      // Ensure module node exists
      await this.ensureModuleNode(filePath);
      
      // Get all call expressions
      const matches = query.matches(tree.rootNode);
      //console.log(`Found ${matches.length} call matches in ${filePath}`);
      
      // First pass: collect all call info without DB operations
      const callInfos: CallInfo[] = [];
      for (const match of matches) {
        let callInfo: CallInfo | null = null;
        
        if (match.captures.some(c => c.name === 'call')) {
          callInfo = await this.extractDirectCallInfo(match, content, filePath);
        } 
        else if (match.captures.some(c => c.name === 'method_call')) {
          callInfo = await this.extractMethodCallInfo(match, content, filePath);
        }
        else if (match.captures.some(c => c.name === 'nested_call')) {
          callInfo = await this.extractNestedCallInfo(match, content, filePath);
        }
        else if (match.captures.some(c => c.name === 'iife')) {
          callInfo = await this.extractIIFEInfo(match, content, filePath);
        }
        
        if (callInfo) {
          callInfos.push(callInfo);
        }
      }
      //console.log(`Extracted ${callInfos.length} call infos from ${filePath}`);
      
      // Process in batches
      const batchSize = 10; // Smaller batch size for better performance
      for (let i = 0; i < callInfos.length; i += batchSize) {
        const batch = callInfos.slice(i, i + batchSize);
        await this.processCallInfoBatch(batch);
        //console.log(`Processed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(callInfos.length/batchSize)}`);
      }
      
      console.log(`Completed extracting ${callInfos.length} calls from ${filePath}`);
    }
    
   /**
   * Extract direct function call information
   */
  private async extractDirectCallInfo(
    match: Parser.QueryMatch,
    content: string,
    filePath: string
  ): Promise<CallInfo | null> {
    const callCapture = match.captures.find(c => c.name === 'call');
    const calleeCapture = match.captures.find(c => c.name === 'callee');
    
    if (!callCapture || !calleeCapture) return null;
    
    const callNode = callCapture.node;
    const calleeName = calleeCapture.node.text;
    
    // Find the containing function (caller)
    const callerInfo = await this.findContainingFunction(callNode, filePath, content);
    
    // Generate call ID
    const callId = this.generateNodeId(
      'call',
      `${callerInfo?.name || 'toplevel'}->${calleeName}`,
      filePath,
      callNode.startPosition.row,
      callNode.startPosition.column
    );
    
    // Extract arguments count
    const argsCount = this.countArguments(callNode);
    
    return {
      id: callId,
      callNode,
      callerInfo,
      calleeName,
      filePath,
      argsCount,
      isTopLevel: !callerInfo,
      callType: callerInfo ? 'direct' : 'toplevel'
    };
  }
    /**
     * Process a batch of call infos with optimized DB operations
     */
    private async processCallInfoBatch(callInfos: CallInfo[]): Promise<void> {
      if (callInfos.length === 0) return;
      
      // Group calls by type to optimize queries
      const topLevelCalls: CallInfo[] = [];
      const functionCalls: CallInfo[] = [];
      
      for (const callInfo of callInfos) {
        if (callInfo.isTopLevel) {
          topLevelCalls.push(callInfo);
        } else {
          functionCalls.push(callInfo);
        }
      }
      
      // Process function calls (non-top-level)
      if (functionCalls.length > 0) {
        await this.processFunctionCalls(functionCalls);
      }
      
      // Process top-level calls
      if (topLevelCalls.length > 0) {
        await this.processTopLevelCalls(topLevelCalls);
      }
    }
    
    /**
     * Process function calls in a batch
     */
    private async processFunctionCalls(calls: CallInfo[]): Promise<void> {
        let x = calls.filter(e => e.callNode.startPosition.row === 112);
       
      await this.dbClient.runInTransaction(async (session) => {
        // 1. Create all Call nodes in a single query
        const callParams = calls.map(call => ({
          id: call.id,
          callerName: call.callerInfo!.name,
          calleeName: call.calleeName,
          lineStart: call.callNode.startPosition.row,
          columnStart: call.callNode.startPosition.column,
          argsCount: call.argsCount,
          callType: 'direct',
          sourceCode: call.callNode.text,
          filePath: call.filePath
        }));
        
        await session.run(`
          UNWIND $calls AS call
          CREATE (c:Call {
            id: call.id,
            callerName: call.callerName,
            calleeName: call.calleeName,
            lineStart: call.lineStart,
            columnStart: call.columnStart,
            argumentCount: call.argsCount,
            callType: 'direct',
            sourceCode: call.sourceCode,
            createdAt: timestamp()
          })
        `, { calls: callParams });
        
        // 2. Connect Call nodes to caller functions
        const callerRelations = calls.map(call => ({
          callId: call.id,
          callerId: call.callerInfo!.id,
          moduleId: `mod:${call.filePath}`
        }));
        
        await session.run(`
          UNWIND $relations AS rel
          MATCH (c:Call {id: rel.callId})
          MATCH (caller:${DbSchema.labels.FUNCTION} {id: rel.callerId})
          MATCH (m:${DbSchema.labels.MODULE} {id: rel.moduleId})
          MERGE (caller)-[:${DbSchema.relationships.CALLS}]->(c)
          MERGE (c)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
        `, { relations: callerRelations });
        
        // 3. Find all callee functions
        const calleeNames = [...new Set(calls.map(call => call.calleeName))];
        const calleeResult = await session.run(`
          MATCH (callee:${DbSchema.labels.FUNCTION})
          WHERE callee.name IN $calleeNames
          RETURN callee.id AS id, callee.name AS name
        `, { calleeNames });

       
       //console.log('Callee names:', calleeNames);
        // Create a map of callee name to id
        const calleeMap = new Map<string, string>();
        for (const record of calleeResult.records) {
          calleeMap.set(record.get('name'), record.get('id'));
        }
       // console.log('Callee result:', calleeMap);
        // 4. Connect calls to existing callees
        const existingCalleeRelations = calls
          .filter(call => calleeMap.has(call.calleeName))
          .map(call => ({
            callId: call.id,
            calleeId: calleeMap.get(call.calleeName)
          }));
        
        if (existingCalleeRelations.length > 0) {
          await session.run(`
            UNWIND $relations AS rel
            MATCH (c:Call {id: rel.callId})
            MATCH (callee:${DbSchema.labels.FUNCTION} {id: rel.calleeId})
            MERGE (c)-[:REFERS_TO]->(callee)
          `, { relations: existingCalleeRelations });
        }
        
        // 5. Create placeholder nodes for unresolved callees
        const unresolvedCallees = calls
          .filter(call => !calleeMap.has(call.calleeName))
          .map(call => ({
            callId: call.id,
            calleeName: call.calleeName
          }));
        
        if (unresolvedCallees.length > 0) {
          await session.run(`
            UNWIND $callees AS callee
            MATCH (c:Call {id: callee.callId})
            MERGE (uf:UnresolvedFunction {name: callee.calleeName})
            MERGE (c)-[:REFERS_TO]->(uf)
          `, { callees: unresolvedCallees });
        }
      });
    }
    
    /**
     * Process top-level calls in a batch
     */
    private async processTopLevelCalls(calls: CallInfo[]): Promise<void> {
      await this.dbClient.runInTransaction(async (session) => {
        // 1. Create all top-level Call nodes in a single query
        const callParams = calls.map(call => ({
          id: call.id,
          calleeName: call.calleeName,
          lineStart: call.callNode.startPosition.row,
          columnStart: call.callNode.startPosition.column,
          sourceCode: call.callNode.text,
          moduleId: `mod:${call.filePath}`
        }));
        
        await session.run(`
          UNWIND $calls AS call
          CREATE (c:Call {
            id: call.id,
            callerName: 'toplevel',
            calleeName: call.calleeName,
            lineStart: call.lineStart,
            columnStart: call.columnStart,
            callType: 'toplevel',
            sourceCode: call.sourceCode,
            createdAt: timestamp()
          })
          WITH c, call
          MATCH (m:${DbSchema.labels.MODULE} {id: call.moduleId})
          MERGE (m)-[:${DbSchema.relationships.CALLS}]->(c)
          MERGE (c)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
        `, { calls: callParams });
        
        // 2. Find all callee functions
        const calleeNames = [...new Set(calls.map(call => call.calleeName))];
        const calleeResult = await session.run(`
          MATCH (callee:${DbSchema.labels.FUNCTION})
          WHERE callee.name IN $calleeNames
          RETURN callee.id AS id, callee.name AS name
        `, { calleeNames });
        
        // Create a map of callee name to id
        const calleeMap = new Map<string, string>();
        for (const record of calleeResult.records) {
          calleeMap.set(record.get('name'), record.get('id'));
        }
        
        // 3. Connect calls to existing callees
        const existingCalleeRelations = calls
          .filter(call => calleeMap.has(call.calleeName))
          .map(call => ({
            callId: call.id,
            calleeId: calleeMap.get(call.calleeName)
          }));
        
        if (existingCalleeRelations.length > 0) {
          await session.run(`
            UNWIND $relations AS rel
            MATCH (c:Call {id: rel.callId})
            MATCH (callee:${DbSchema.labels.FUNCTION} {id: rel.calleeId})
            MERGE (c)-[:REFERS_TO]->(callee)
          `, { relations: existingCalleeRelations });
        }
      });
    }

     /**
   * Extract method call information
   */
  private async extractMethodCallInfo(
    match: Parser.QueryMatch,
    content: string,
    filePath: string
  ): Promise<CallInfo | null> {
    const methodCallCapture = match.captures.find(c => c.name === 'method_call');
    const objectCapture = match.captures.find(c => c.name === 'object');
    const methodCapture = match.captures.find(c => c.name === 'method');
    
    if (!methodCallCapture || !objectCapture || !methodCapture) return null;
    
    const callNode = methodCallCapture.node;
    const objectName = objectCapture.node.text;
    const methodName = methodCapture.node.text;
    const fullCallName = `${objectName}.${methodName}`;
    
    // Find the containing function (caller)
    const callerInfo = await this.findContainingFunction(callNode, filePath, content);
    
    // Generate call ID
    const callId = this.generateNodeId(
      'call',
      `${callerInfo?.name || 'toplevel'}->${fullCallName}`,
      filePath,
      callNode.startPosition.row,
      callNode.startPosition.column
    );
    
    // Extract arguments count
    const argsCount = this.countArguments(callNode);
    
    return {
      id: callId,
      callNode,
      callerInfo,
      calleeName: fullCallName,
      objectName,
      methodName,
      filePath,
      argsCount,
      isTopLevel: !callerInfo,
      callType: callerInfo ? 'method' : 'toplevel'
    };
  }

   /**
   * Extract nested call information
   */
   private async extractNestedCallInfo(
    match: Parser.QueryMatch,
    content: string,
    filePath: string
  ): Promise<CallInfo | null> {
    const outerCallCapture = match.captures.find(c => c.name === 'outer_call');
    const outerFunctionCapture = match.captures.find(c => c.name === 'outer_function');
    
    if (!outerCallCapture || !outerFunctionCapture) return null;
    
    const callNode = outerCallCapture.node;
    const calleeName = outerFunctionCapture.node.text || '[nested]';
    
    // Find the containing function (caller)
    const callerInfo = await this.findContainingFunction(callNode, filePath, content);
    
    // Generate call ID
    const callId = this.generateNodeId(
      'call',
      `${callerInfo?.name || 'toplevel'}->${calleeName}:nested`,
      filePath,
      callNode.startPosition.row,
      callNode.startPosition.column
    );
    
    // Extract arguments count
    const argsCount = this.countArguments(callNode);
    
    return {
      id: callId,
      callNode,
      callerInfo,
      calleeName: `${calleeName}(nested)`,
      filePath,
      argsCount,
      isTopLevel: !callerInfo,
      callType: 'nested'
    };
  }
  
    
    /**
     * Find the function that contains a given node
     * Uses caching to avoid repeated tree traversals and DB queries
     */
    private async findContainingFunction(
      node: Parser.SyntaxNode,
      filePath: string,
      content: string
    ): Promise<{ id: string, name: string } | null> {
      // Generate a cache key based on node position
      const cacheKey = `${filePath}:${node.startPosition.row}:${node.startPosition.column}`;
      
      // Check if we already processed this node position
      if (this.functionCache.has(cacheKey)) {
        return this.functionCache.get(cacheKey)!;
      }
      
      try {
        let current = node.parent;
        
        // Navigate up the tree to find a function node
        while (current) {
          if (
            current.type === 'function_declaration' ||
            current.type === 'function_expression' ||
            current.type === 'arrow_function' ||
            current.type === 'method_definition' ||
            (current.type === 'pair' && 
             (current.childForFieldName('value')?.type === 'function_expression' || 
              current.childForFieldName('value')?.type === 'arrow_function')) ||
            (current.type === 'method_definition' && current.parent?.type === 'object')
          ) {
            // Generate a function cache key
            const funcCacheKey = `${filePath}:${current.startPosition.row}:${current.startPosition.column}`;
            
            // Check if we already identified this function
            if (this.functionCache.has(funcCacheKey)) {
              const result = this.functionCache.get(funcCacheKey)!;
              this.functionCache.set(cacheKey, result); // Cache for original node too
              return result;
            }
            
            // Identify the function
            const result = await this.identifyFunction(current, filePath, content);
            if (result) {
              // Cache both the function node and the original node
              this.functionCache.set(funcCacheKey, result);
              this.functionCache.set(cacheKey, result);
              return result;
            }
          }
          
          current = current.parent;
        }
        
        // Cache null result
        this.functionCache.set(cacheKey, null);
        return null;
      } catch (error) {
        console.error(`Error finding containing function at ${node.startPosition.row}:${node.startPosition.column} in ${filePath}:`, error);
        return null;
      }
    }

     /**
   * Extract IIFE information
   */
  private async extractIIFEInfo(
    match: Parser.QueryMatch,
    content: string,
    filePath: string
  ): Promise<CallInfo | null> {
    const iifeCapture = match.captures.find(c => c.name === 'iife');
    const iifeFunctionCapture = match.captures.find(c => c.name === 'iife_function');
    
    if (!iifeCapture) return null;
    
    const callNode = iifeCapture.node;
    
    // Find the containing function (caller)
    const callerInfo = await this.findContainingFunction(callNode, filePath, content);
    
    // Generate call ID
    const callId = this.generateNodeId(
      'call',
      `${callerInfo?.name || 'toplevel'}->IIFE`,
      filePath,
      callNode.startPosition.row,
      callNode.startPosition.column
    );
    
    return {
      id: callId,
      callNode,
      callerInfo,
      calleeName: 'IIFE',
      filePath,
      argsCount: 0, // IIFEs don't have traditional arguments
      isTopLevel: !callerInfo,
      callType: 'iife'
    };
  }
    
    /**
     * Identify a function node and return its info
     * Optimized to reduce database operations
     */
    private async identifyFunction(
      funcNode: Parser.SyntaxNode,
      filePath: string,
      content: string
    ): Promise<{ id: string, name: string } | null> {
      try {
        let funcName = '<anonymous>';
        
        // Extract function name based on node type
        if (funcNode.type === 'function_declaration') {
          const nameNode = funcNode.childForFieldName('name');
          if (nameNode) funcName = nameNode.text;
        }
        else if (funcNode.type === 'method_definition') {
          const nameNode = funcNode.childForFieldName('name');
          if (nameNode) {
            // Check for class context
            let current = funcNode.parent;
            let className = null;
            
            while (current) {
              if (current.type === 'class_declaration' || current.type === 'class') {
                const classNameNode = current.childForFieldName('name');
                if (classNameNode) {
                  className = classNameNode.text;
                  break;
                }
              }
              current = current.parent;
            }
            
            funcName = className ? `${className}.${nameNode.text}` : nameNode.text;
          }
        }
        else if (funcNode.type === 'arrow_function' || funcNode.type === 'function_expression') {
          // Handle variable assignments, object properties, etc.
          let current = funcNode.parent;
          
          while (current) {
            if (current.type === 'variable_declarator') {
              const nameNode = current.childForFieldName('name');
              if (nameNode) {
                funcName = nameNode.text;
                break;
              }
            } else if (current.type === 'pair') {
              const keyNode = current.childForFieldName('key');
              if (keyNode) {
                funcName = keyNode.text;
                break;
              }
            } else if (current.type === 'assignment_expression') {
              const leftNode = current.childForFieldName('left');
              if (leftNode) {
                funcName = leftNode.text;
                break;
              }
            } else if (current.type === 'export_statement') {
              funcName = 'default_export';
              break;
            }
            
            current = current.parent;
          }
        }
        
        // Generate a unique ID for this function
        const funcId = this.generateNodeId(
          'func',
          funcName,
          filePath,
          funcNode.startPosition.row,
          funcNode.startPosition.column
        );
        
        // Check if this function exists in the database
        // Use a light query with indexes
        const result = await this.dbClient.query(`
          MATCH (f:${DbSchema.labels.FUNCTION})
          WHERE f.id = $funcId 
          RETURN f.id AS id, f.name AS name
          LIMIT 1
        `, {
          funcId
        });
        
        if (result.length > 0) {
          return {
            id: result[0].id,
            name: result[0].name || funcName
          };
        }
        
        // Function doesn't exist - create it
        const sourceCode = funcNode.text.length > 500 
          ? funcNode.text.substring(0, 500) + '...' 
          : funcNode.text;
        
        await this.dbClient.query(`
          // Create function node
          MERGE (f:${DbSchema.labels.FUNCTION} {id: $funcId})
          ON CREATE SET 
            f.name = $funcName,
            f.lineStart = $lineStart,
            f.lineEnd = $lineEnd,
            f.columnStart = $columnStart,
            f.columnEnd = $columnEnd,
            f.sourceCode = $sourceCode,
            f.isPlaceholder = true,
            f.createdAt = timestamp()
          
          // Connect to module
          WITH f
          MATCH (m:${DbSchema.labels.MODULE} {id: $moduleId})
          MERGE (f)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
        `, {
          funcId,
          funcName,
          lineStart: funcNode.startPosition.row,
          lineEnd: funcNode.endPosition.row,
          columnStart: funcNode.startPosition.column,
          columnEnd: funcNode.endPosition.column,
          sourceCode,
          moduleId: `mod:${filePath}`
        });
        
        return {
          id: funcId,
          name: funcName
        };
      } catch (error) {
        console.error(`Error identifying function at ${funcNode.startPosition.row}:${funcNode.startPosition.column} in ${filePath}:`, error);
        return null;
      }
    }
    
    /**
     * Count arguments in a call expression
     */
    private countArguments(callNode: Parser.SyntaxNode): number {
      try {
        const argsNode = callNode.childForFieldName('arguments');
        if (!argsNode) return 0;
        
        let count = 0;
        let inArg = false;
        
        for (let i = 0; i < argsNode.childCount; i++) {
          const child = argsNode.child(i);
          if (!child) continue;
          
          if (child.type !== ',') {
            if (!inArg) {
              count++;
              inArg = true;
            }
          } else {
            inArg = false;
          }
        }
        
        return count;
      } catch (error) {
        console.error('Error counting arguments:', error);
        return 0;
      }
    }
    
    /**
     * Clear function cache
     */
    public clearCache(): void {
      this.functionCache.clear();
    }
  }