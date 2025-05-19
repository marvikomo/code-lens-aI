import Parser from 'tree-sitter'
import { Extractor } from './extractor'
import { Neo4jClient } from '../db/neo4j-client'
import { DbSchema } from '../db/schema'
import { logger } from '../logger'
import { FunctionNodeService } from '../services/function-node-service'
import { NodeType } from '../enum/NodeType'
import { TreeSitterUtil } from '../util/tree-sitter-util'
import { ClassNodeService } from '../services/class-node-service'

export class VariableExtractor extends Extractor {
  private functionNodeService: FunctionNodeService
  private classNodeService: ClassNodeService
  constructor(dbClient: Neo4jClient, treeSitterUtil: TreeSitterUtil) {
    super(dbClient, treeSitterUtil)
    this.functionNodeService = new FunctionNodeService(dbClient)
    this.classNodeService = new ClassNodeService(dbClient)
  }

  /**
   * Extract variables from a parsed file and store in Neo4j
   */
  async extract(
    tree: Parser.Tree,
    content: string,
    filePath: string,
    query: Parser.Query,
  ): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath)

    // Execute query against AST
    const matches = query.matches(tree.rootNode)

    logger.writeResults(matches, 'variable_matches')

    // Filter out variable references to process only declarations
    // Filter out different types of matches
    const declarations = matches.filter((match) => {
      const captureNames = match.captures.map((c) => c.name)
      return captureNames.some(
        (name) =>
          name === 'var_with_value' || // Variable with initial value (e.g., const a = 10)
          name === 'var_with_function' ||
          name === 'var_with_class' ||
          name === 'var_with_object' ||
          // Standard variable declarations
          name === 'const_declaration' || // General const declarations (const a)
          name === 'let_declaration' || // General let declarations (let a)
          name === 'var_declaration' || // General var declarations (var a)
          name === 'exported_var' || // Exported variable declarations
          // Function-type variables
          name === 'method_declaration' ||
          name === 'function_declaration' ||
          name === 'arrow_function' ||
          // Import declarations
          name === 'import_var' ||
          name === 'default_import' ||
          // Other specialized variables
          name === 'destructuring' ||
          name === 'nested_destructuring' ||
          // Parameter types
          name === 'rest_param' ||
          name === 'default_param' ||
          name === 'catch_param' ||
          // Loop variables
          name === 'for_of_var' ||
          name === 'for_in_var' ||
          // Instance properties
          name === 'instance_property',
      )
    })
    console.log(
      `Found ${declarations.length} variable declarations in ${filePath}`,
    )


    // Process in batches
    const batchSize = 20
    for (let i = 0; i < declarations.length; i += batchSize) {
      const batch = declarations.slice(i, i + batchSize)
      await this.processVariableBatch(batch, content, filePath, tree)
    }

  
    console.log(`Extracted ${declarations.length} variables from ${filePath}`)
  }

  /**
   * Process a batch of variable matches
   */
  private async processVariableBatch(
    matches: Parser.QueryMatch[],
    content: string,
    filePath: string,
    tree: Parser.Tree,
  ): Promise<void> {
    // Create a map to store variables with their details
    const variableMap = new Map<string, any>()
    try {
      for (const match of matches) {
        // Get variable name capture
        const nameCapture = match.captures.find((c) => c.name === 'name')

        if (!nameCapture) continue

        const varName = nameCapture.node.text
        const startPosition = nameCapture.node.startPosition
        const endPosition = nameCapture.node.endPosition

        // Determine variable type from the match
        const isConst = match.captures.some(
          (c) => c.name === 'const_declaration' || c.name === 'const_keyword',
        )
        const isLet = match.captures.some(
          (c) => c.name === 'let_declaration' || c.name === 'let_keyword',
        )
        const isVar = match.captures.some((c) => c.name === 'var_declaration')
        const isExported = match.captures.some((c) => c.name === 'exported_var')
        const isImport = match.captures.some(
          (c) => c.name === 'import_var' || c.name === 'default_import',
        )
        const isFunction = match.captures.some(
          (c) => c.name === 'var_with_function',
        )
        const isClass = match.captures.some((c) => c.name === 'var_with_class')
        const isObject = match.captures.some(
          (c) => c.name === 'var_with_object',
        )
        const isDestructured = match.captures.some(
          (c) =>
            c.name === 'destructuring' || c.name === 'nested_destructuring',
        )
        const isRestParam = match.captures.some((c) => c.name === 'rest_param')
        const isDefaultParam = match.captures.some(
          (c) => c.name === 'default_param',
        )
        const isCatchParam = match.captures.some(
          (c) => c.name === 'catch_param',
        )
        const isLoopVar = match.captures.some(
          (c) => c.name === 'for_of_var' || c.name === 'for_in_var',
        )

        // Determine variable type string
        let varType = 'var' // default
        if (isConst) varType = 'const'
        else if (isLet) varType = 'let'
        else if (isImport) varType = 'import'
        else if (isFunction) varType = 'function'
        else if (isClass) varType = 'class'
        else if (isObject) varType = 'object'
        else if (isRestParam) varType = 'rest_param'
        else if (isDefaultParam) varType = 'default_param'
        else if (isCatchParam) varType = 'catch_param'
        else if (isLoopVar) varType = 'loop_var'
        else if (isDestructured) varType = 'destructured'

        if (!varName) continue

        if (!variableMap.has(varName)) {
          variableMap.set(varName, {
            variableId: null,
            varScope: null,
            varType: varType,
            declarationNode: null,
            code: "",
            refContext : '',
            scopeRefContext: '',
            value: '',
            context: '',
            lineStart: '',
            lineEnd: '',
            parentId: '',
            parentClassName: '',
            parentFunctionName: '',
            parentFunctionId: '',
            valueCaptureRef: {
              type: '',
              id: null,
            },
            variableReferences: [], // Collecting all references for the variable
          })
        }

        const variableDetails = variableMap.get(varName)

        var line = match.captures.some(
          (c) => c.node.startPosition.row + 1 === 11,
        )

        

        variableDetails.varType = varType

        // Get the declaration node
        const declarationCapture = match.captures.find(
          (c) =>
            c.name === 'var_with_value' || // Check for variables with values first
            c.name === 'var_with_function' ||
            c.name === 'var_with_class' ||
            c.name === 'var_with_object' ||
            c.name === 'destructuring' || // Destructuring comes next
            c.name === 'nested_destructuring' ||
            c.name === 'default_param' || // Default parameters come next
            c.name === 'rest_param' || // Rest parameters
            c.name === 'catch_param' || // Catch clause parameters
            c.name === 'for_of_var' || // For-of loop variables
            c.name === 'for_in_var' || // For-in loop variables
            c.name === 'instance_property' || // Instance properties
            c.name === 'const_declaration' || // Constant declarations
            c.name === 'let_declaration' || // Let declarations
            c.name === 'var_declaration' || // Var declarations
            c.name === 'method_declaration' || // Method declarations
            c.name === 'function_declaration' || // Function declarations
            c.name === 'arrow_function' || // Arrow function parameters
            c.name === 'var_reference' || // Variable references
            c.name === 'exported_var' || // Exported variables
            c.name === 'import_var' || // Imported variables
            c.name === 'default_import', // Default imports
        )

        if (!declarationCapture) continue

        const declarationNode = declarationCapture.node

        variableDetails.lineStart = declarationNode.startPosition.row;
        variableDetails.lineEnd = declarationNode.endPosition.row;

        variableDetails.declarationNode = declarationNode
        variableDetails.code = declarationNode.text

        let valueCapture = match.captures.find(
          (c) => c.name === 'value' || c.name === 'default_value',
        )

        if (valueCapture && valueCapture.node) {
          variableDetails.value =
            valueCapture.node.text.length > 200
              ? valueCapture.node.text.substring(0, 200) + '...'
              : valueCapture.node.text
        }

        // Determine the context (function, class, etc.)
        const varScope = this.determineVariableScope(declarationNode)
        const parentContext = this.determineParentContext(declarationNode)
        variableDetails.context = parentContext
          ? `${parentContext}.${varName}`
          : varName

        
         

        if (valueCapture && valueCapture.node) {
         
          //if value capture is a function, get the function name
          if (
            valueCapture.node.type === NodeType.ArrowFunction ||
            valueCapture.node.type === NodeType.FunctionExpression ||
            valueCapture.node.type === NodeType.FunctionDeclaration
          ) {
            let startLine = valueCapture.node.startPosition.row
            let endLine = valueCapture.node.endPosition.row

            let res = await this.functionNodeService.searchFunctions({
              startLine,
              endLine,
            })

            if (res.length > 0) {
              variableDetails.valueCaptureRef = {
                type: 'function',
                id: res[0].functionId,
                name: res[0].funcFullName,
              }
            }
          } else if (valueCapture.node.type == NodeType.Identifier) {
            let ref: any = this.treeSitterUtils.findDeclarationNode(
              tree,
              valueCapture.node.text
            );

   
                if (ref && ref.type === 'function') {
                  let startLine = ref.node.startPosition.row
                  let endLine = ref.node.endPosition.row + 1
                  let response = await this.functionNodeService.searchFunctions(
                    {
                      name: valueCapture.node.text,
                      startLine,
                      endLine,
                    },
                  )

                  if (response.length > 0) {
                    variableDetails.valueCaptureRef = {
                      type: 'function',
                      id: response[0].functionId,
                      name: response[0].funcFullName,
                    }
                    variableDetails.refContext = `Value references to function of id: ${response[0].functionId} and name: ${response[0].funcFullName}`
                  }
                } else if (ref && ref.type === 'class') {
                  let response = await this.classNodeService.searchClasses({
                    name: valueCapture.node.text,
                    startLine: ref.node.startPosition.row,
                    endLine: ref.node.endPosition.row,
                  })

                  if (response.length > 0) {
                    variableDetails.valueCaptureRef = {
                      type: 'class',
                      id: response[0].classId,
                      name: response[0].className,
                    }
                     variableDetails.refContext = `Value references to class of id: ${response[0].classId} and name: ${response[0].className}`
                  }
                }else if (ref && ref.type === 'import') {
                  // if(line) {
                    
      
                  //   console.log('res', ref)
      
      
                  // }
                 


                }else if (ref && ref.type === 'variable') {
                  variableDetails.valueCaptureRef = {
                    type: 'variable',
                    name: valueCapture.node.text,
                  }
                    variableDetails.refContext = `Value references to variable  of name:  ${valueCapture.node.text}}`
                }
              
            
          } else if (
            valueCapture.node.type === NodeType.ClassDeclaration ||
            valueCapture.node.type === NodeType.Class ||
            valueCapture.node.type === NodeType.NewExpression ||
            valueCapture.node.type === NodeType.ClassDeclaration ||
            valueCapture.node.type === NodeType.ClassExpression
          ) {
            let startLine = valueCapture.node.startPosition.row
            let endLine = valueCapture.node.endPosition.row
            let response = await this.classNodeService.searchClasses({
              name: valueCapture.node.text,
              startLine: startLine,
              endLine: endLine,
            })

            if (response.length > 0) {
              variableDetails.valueCaptureRef = {
                type: 'class',
                id: response[0].classId,
                name: response[0].className,
              }
                variableDetails.refContext = `value references to class of id: ${response[0].classId} and name: ${response[0].className}`
            }
          }
        }

        const variableId = this.generateNodeId(
          'var',
          varName,
          filePath,
          startPosition.row,
          startPosition.column,
        )

     
        variableDetails.varScope = varScope

        variableDetails.scopeRefContext = "Variable is defined in module"

        if(varScope === 'function') {
          const parentFuncId = this.findParentFunctionId(
            declarationNode,
            filePath,
          )

          variableDetails.parentId = parentFuncId
         
  
         variableDetails.scopeRefContext = `Variable is defined in function of id: ${parentFuncId}`

        }else if(varScope === 'class') {
          const parentClassId = this.findParentClassId(
            declarationNode,
            filePath,
          )
          variableDetails.parentId = parentClassId

           variableDetails.scopeRefContext = `Variable is defined in class of id: ${parentClassId}`

        }else if(varScope === 'block') {
          const parentClassId = this.findParentClassId(
            declarationNode,
            filePath,
          )
          variableDetails.parentId = parentClassId
          variableDetails.scopeRefContext = `Variable is defined in function of id: ${parentClassId}`
        }

        variableDetails.variableId = variableId

        // if (line) {
        //  console.log("varName", varName)
        //   console.log("capp", match.captures)
        //   match.captures.map(e => {
        //     console.log("text", e.node.text)
        //   })
        //   console.log("value captured", valueCapture)
        // }

        // Store class and function details (if applicable)
        // if (this.isInstanceProperty(match)) {
        //   const className = this.findContainingClassName(nameCapture.node);
        //   const classId = this.findParentClassId(nameCapture.node, filePath);
        //   variableDetails.parentClassId = classId || '';
        //   variableDetails.parentClassName = className || '';
        // }
      }

      await this.bulkInsertVariables(variableMap, filePath)
    } catch (error) {
      console.error('Error processing variable:', error)
    }
  }

  /**
   * Bulk insert variables from the variable map using UNWIND
   * @param variableMap Map containing processed variable information
   * @param filePath The file path of the parsed file
   */
  private async bulkInsertVariables(
    variableMap: Map<string, any>,
    filePath: string,
  ): Promise<void> {
    if (variableMap.size === 0) return

    // Convert map to array for UNWIND operation
    const variableArray = Array.from(variableMap.values())
      .filter((v) => v.variableId) // Ensure we have valid IDs
      .map((v) => ({
        variableId: v.variableId,
        name: v.variableId.split(':')[2], // Extract name from ID
        fullName: v.context || v.variableId.split(':')[2],
        context: v.context,
        code: v.code,
        refContext: v.refContext,
        scopeRefContext: v.scopeRefContext,
        lineStart: v.lineStart,
        lineEnd: v.lineEnd, 
        columnStart: parseInt(v.variableId.split(':')[4], 10),
        columnEnd: parseInt(v.variableId.split(':')[4], 10) + 10, // Estimate end column if not available
        type: v.varType || 'var',
        scope: v.varScope || 'module',
        value: v.value || '',
        isExported: v.isExported || false,
      }))

      console.log("var arr", variableArray)
    // Prepare relationship data arrays
    const moduleRelations = variableArray.map((v) => ({
      variableId: v.variableId,
      moduleId: `mod:${filePath}`,
    }))

    // Function relations - variables declared inside functions
    const functionRelations = variableArray
      .filter((v) => v.scope === 'function')
      .map((v) => {
        const varData = variableMap.get(v.name)
        
        return {
          variableId: v.variableId,
          functionId: varData.parentId,
        }
      })
      .filter((rel) => rel.functionId) // Only include if function ID exists

    // Class relations - variables declared inside classes
    const classRelations = variableArray
      .filter((v) => v.scope === 'class')
      .map((v) => {
        const varData = variableMap.get(v.name)
        return {
          variableId: v.variableId,
          classId: varData.parentId,
        }
      })
      .filter((rel) => rel.classId) // Only include if class ID exists

    // Reference relations - variables referencing other entities
    const referenceRelations = variableArray
      .filter((v) => {
        const varData = variableMap.get(v.name)
        return varData.valueCaptureRef && varData.valueCaptureRef.id
      })
      .map((v) => {
        const varData = variableMap.get(v.name)
        return {
          variableId: v.variableId,
          refId: varData.valueCaptureRef.id,
          refType: varData.valueCaptureRef.type,
        }
      })

    await this.dbClient.runInTransaction(async (session) => {
      try {
        // 1. Bulk insert all variable nodes
        await session.run(
          `
        UNWIND $variables AS var
        MERGE (v:${DbSchema.labels.VARIABLE} {id: var.variableId})
        ON CREATE SET 
          v.name = var.name,
          v.fullName = var.fullName,
          v.lineStart = var.lineStart,
          v.lineEnd = var.lineEnd,
          v.code = var.code,
          v.context = var.context,
          v.refContext = var.refContext,
          v.scopeRefContext = var.scopeRefContext,
          v.columnStart = var.columnStart,
          v.columnEnd = var.columnEnd,
          v.type = var.type,
          v.scope = var.scope,
          v.value = var.value,
          v.isExported = var.isExported,
          v.createdAt = timestamp()
        ON MATCH SET
          v.name = var.name,
          v.fullName = var.fullName,
          v.lineStart = var.lineStart,
          v.lineEnd = var.lineEnd,
          v.code = var.code,
          v.context = var.context,
          v.refContext = var.refContext,
          v.scopeRefContext = var.scopeRefContext,
          v.columnStart = var.columnStart,
          v.columnEnd = var.columnEnd,
          v.type = var.type,
          v.scope = var.scope,
          v.value = var.value,
          v.isExported = var.isExported,
          v.updatedAt = timestamp()
      `,
          { variables: variableArray },
        )

        // 2. Bulk create DEFINED_IN relationships to modules
        await session.run(
          `
        UNWIND $relations AS rel
        MATCH (v:${DbSchema.labels.VARIABLE} {id: rel.variableId})
        MATCH (m:${DbSchema.labels.MODULE} {id: rel.moduleId})
        MERGE (v)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
      `,
          { relations: moduleRelations },
        )

        // 3. Create scope relationships based on scope type

        // 3a. Module scope variables - GLOBAL_IN
        const moduleScopes = variableArray.filter((v) => v.scope === 'module')
        if (moduleScopes.length > 0) {
          await session.run(
            `
          UNWIND $variables AS var
          MATCH (v:${DbSchema.labels.VARIABLE} {id: var.variableId})
          MATCH (m:${DbSchema.labels.MODULE} {id: $moduleId})
          MERGE (v)-[:${DbSchema.relationships.GLOBAL_IN}]->(m)
        `,
            {
              variables: moduleScopes,
              moduleId: `mod:${filePath}`,
            },
          )
        }

        // 3b. Function scope variables - LOCAL_TO + LIFETIME_OF
        if (functionRelations.length > 0) {
          await session.run(
            `
          UNWIND $relations AS rel
          MATCH (v:${DbSchema.labels.VARIABLE} {id: rel.variableId})
          MATCH (f:${DbSchema.labels.FUNCTION} {id: rel.functionId})
          MERGE (v)-[:${DbSchema.relationships.LOCAL_TO}]->(f)
          MERGE (v)-[:${DbSchema.relationships.LIFETIME_OF}]->(f)
        `,
            { relations: functionRelations },
          )
        }

        // 3c. Class scope variables - LOCAL_TO + LIFETIME_OF
        if (classRelations.length > 0) {
          await session.run(
            `
          UNWIND $relations AS rel
          MATCH (v:${DbSchema.labels.VARIABLE} {id: rel.variableId})
          MATCH (c:${DbSchema.labels.CLASS} {id: rel.classId})
          MERGE (v)-[:${DbSchema.relationships.LOCAL_TO}]->(c)
          MERGE (v)-[:${DbSchema.relationships.LIFETIME_OF}]->(c)
        `,
            { relations: classRelations },
          )
        }

        // 4. Create reference relationships
        if (referenceRelations.length > 0) {
          // Split by reference type
          const functionRefs = referenceRelations.filter(
            (r) => r.refType === 'function',
          )
          const classRefs = referenceRelations.filter(
            (r) => r.refType === 'class',
          )
          const variableRefs = referenceRelations.filter(
            (r) => r.refType === 'variable',
          )

          // 4a. Function references
          if (functionRefs.length > 0) {
            await session.run(
              `
            UNWIND $relations AS rel
            MATCH (v:${DbSchema.labels.VARIABLE} {id: rel.variableId})
            MATCH (f:${DbSchema.labels.FUNCTION} {id: rel.refId})
            MERGE (v)-[:${DbSchema.relationships.REFERS_TO}]->(f)
          `,
              { relations: functionRefs },
            )
          }

          // 4b. Class references
          if (classRefs.length > 0) {
            await session.run(
              `
            UNWIND $relations AS rel
            MATCH (v:${DbSchema.labels.VARIABLE} {id: rel.variableId})
            MATCH (c:${DbSchema.labels.CLASS} {id: rel.refId})
            MERGE (v)-[:${DbSchema.relationships.REFERS_TO}]->(c)
          `,
              { relations: classRefs },
            )
          }

          // 4c. Variable references
          if (variableRefs.length > 0) {
            await session.run(
              `
            UNWIND $relations AS rel
            MATCH (v:${DbSchema.labels.VARIABLE} {id: rel.variableId})
            MATCH (vr:${DbSchema.labels.VARIABLE} {name: rel.refName})
            WHERE vr.scope = 'module'
            MERGE (v)-[:${DbSchema.relationships.REFERS_TO}]->(vr)
          `,
              { relations: variableRefs },
            )
          }
        }

        console.log(`Bulk inserted ${variableArray.length} variables`)
      } catch (error) {
        console.error('Error during bulk insert:', error)
        throw error
      }
    })
  }

 



  /**
   * Determine the scope of the variable
   */
  private determineVariableScope(node: Parser.SyntaxNode): string {
    // Find closest scope-defining parent
    let parent = node.parent
    let depth = 0
    const maxDepth = 10 // Prevent infinite loops

    while (parent && depth < maxDepth) {
      if (parent.type === 'program') {
        return 'module'
      } else if (
        parent.type === 'function_declaration' ||
        parent.type === 'function_expression' ||
        parent.type === 'arrow_function' ||
        parent.type === 'method_definition'
      ) {
        return 'function'
      } else if (
        parent.type === 'class_declaration' ||
        parent.type === 'class_expression' ||
        parent.type === 'class' ||
        parent.type === 'class_body'
      ) {
        return 'class'
      } else if (parent.type === 'block') {
        // Check if this block belongs to a function, class, or is standalone
        const blockParent = parent.parent
        if (blockParent) {
          if (
            blockParent.type.includes('function') ||
            blockParent.type.includes('method')
          ) {
            return 'function'
          } else if (blockParent.type.includes('class')) {
            return 'class'
          } else if (
            blockParent.type.includes('if') ||
            blockParent.type.includes('for') ||
            blockParent.type.includes('while')
          ) {
            return 'block'
          }
        }
        return 'block'
      }

      parent = parent.parent
      depth++
    }

    // Default to module scope if no specific scope found
    return 'module'
  }

  /**
   * Try to determine parent context for a variable (class name, object name, etc.)
   */
  private determineParentContext(node: Parser.SyntaxNode): string {
    let parent = node
    let depth = 0
    const maxDepth = 10 // Prevent infinite loops

    while (parent && depth < maxDepth) {
      parent = parent.parent
      depth++

      if (!parent) break

      if (parent.type === 'function_declaration') {
        const nameNode = parent.childForFieldName('name')
        if (nameNode) {
          return nameNode.text
        }
      } else if (parent.type === 'method_definition') {
        const methodName = parent.childForFieldName('name')?.text || ''
        const classBodyNode = parent.parent
        if (classBodyNode && classBodyNode.type === 'class_body') {
          const classNode = classBodyNode.parent
          if (
            classNode &&
            (classNode.type === 'class_declaration' ||
              classNode.type === 'class')
          ) {
            const className = classNode.childForFieldName('name')?.text || ''
            if (className && methodName) {
              return `${className}.${methodName}`
            } else if (className) {
              return className
            }
          }
        }
        return methodName || ''
      } else if (parent.type === 'class_declaration') {
        const nameNode = parent.childForFieldName('name')
        if (nameNode) {
          return nameNode.text
        }
      }
    }

    return ''
  }

  /**
   * Try to find parent function ID for a variable node
   */
  private findParentFunctionId(
    node: Parser.SyntaxNode,
    filePath: string,
  ): string | null {
    let parent = node
    let depth = 0
    const maxDepth = 10 // Prevent infinite loops

    while (parent && depth < maxDepth) {
      parent = parent.parent
      depth++

      if (!parent) break

      if (
        parent.type === 'function_declaration' ||
        parent.type === 'function_expression' ||
        parent.type === 'arrow_function' ||
        parent.type === 'method_definition'
      ) {
        // Get function name
        const nameNode = parent.childForFieldName('name')
        const funcName = nameNode ? nameNode.text : '<anonymous>'

        // Generate function ID
        return this.generateNodeId(
          'func',
          funcName,
          filePath,
          parent.startPosition.row,
          parent.startPosition.column,
        )
      }
    }

    return null
  }

  private findParentClassId(
    node: Parser.SyntaxNode,
    filePath: string,
  ): string | null {
    let parent = node
    let depth = 0
    const maxDepth = 10 // Prevent infinite loops

    while (parent && depth < maxDepth) {
      parent = parent.parent
      depth++

      if (!parent) break

      if (
        parent.type === 'class_declaration' ||
        parent.type === 'class_expression' ||
        parent.type === 'class'
      ) {
        // Get class name
        const nameNode = parent.childForFieldName('name')
        const className = nameNode ? nameNode.text : '<anonymous>'

        // Generate class ID
        return this.generateNodeId(
          'class',
          className,
          filePath,
          parent.startPosition.row,
          parent.startPosition.column,
        )
      }
    }

    return null
  }

  /**
   * Find the source module of an import
   */
  private findImportSource(node: Parser.SyntaxNode): string | null {
    // Look for import declaration parent
    let parent = node
    let depth = 0
    const maxDepth = 5

    while (parent && depth < maxDepth) {
      if (parent.type === 'import_statement') {
        const sourceNode = parent.childForFieldName('source')
        if (sourceNode) {
          // Remove quotes from source string
          let source = sourceNode.text
          if (source.startsWith('"') || source.startsWith("'")) {
            source = source.substring(1, source.length - 1)
          }
          return source
        }
        break
      }
      parent = parent.parent
      depth++
    }

    return null
  }


}
