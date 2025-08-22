import Parser from 'tree-sitter'
import * as fs from 'fs'
import * as path from 'path'
import { Extractor } from './extractor'
import { Neo4jClient } from '../db/neo4j-client'
import { DbSchema } from '../db/schema'
import { TreeSitterUtil } from '../util/tree-sitter-util'
import { resolveImport } from 'resolve-import'
import { ClassNodeService } from '../services/class-node-service'
import { FunctionNodeService } from '../services/function-node-service'
import { ImportNodeService } from '../services/import-node-service'
import { CodeVectorStore } from '../vector-store'
import { Graph } from 'graphlib'

export class ModuleLEvelExtractor extends Extractor {
 
  constructor(
    treeSitterUtil: TreeSitterUtil,
    vectorStore: CodeVectorStore,
    graph: Graph,
  ) {
    super(treeSitterUtil, vectorStore, graph)
   
  }

  /**
   * Extract import statements from a parsed file and store in Neo4j
   */
  async extract(
    tree: Parser.Tree,
    content: string,
    filePath: string,
    query: Parser.Query,
    lspClient: any = null,
  ): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath)
    console.log('extracting module level relationships from file:', filePath)

    const matches = query.matches(tree.rootNode)
    console.log('matches:', matches.length, 'total matches')

    const imports = []

    for (const match of matches) {
      const importCapture = match.captures.find((c) => c.name === 'import')

      if (!importCapture) continue

      // Create a unique identifier for this import statement based on its position
      const importKey = `${importCapture.node.startPosition.row}:${importCapture.node.startPosition.column}`

      // Extract import names from different capture types
      const importNames = this.extractImportNames(match)
      const importSource = this.extractImportSource(match)

      // Handle each import name separately with individual character positions
      if (importNames.length > 0) {
        for (const importInfo of importNames) {
          console.log(
            'Import at position',
            importCapture.node.startPosition.row,
            ':',
            {
              name: importInfo.name,
              source: importSource,
              character: importInfo.character,
              fullText: importCapture.node.text,
            },
          )
          const fnId = this.generateNodeId(
            'import',
            importInfo.name,
            filePath,
            importCapture.node.startPosition.row + 1,
            importCapture.node.endPosition.row + 1,
            importCapture.node.startPosition.column + 1,
            importCapture.node.endPosition.column + 1,
          )
          this.graph.setNode(fnId, {
            type: 'import',
            name: importInfo.name,
            moduleDefinedIn: filePath,
            rowStart: importCapture.node.startPosition.row + 1,
            rowEnd: importCapture.node.endPosition.row + 1,
            columnStart: importInfo.character,
          })
        }
      } else {
        // Fallback for imports without specific names (like side-effect imports)
        const character = this.getCharacterFromTreeSitterNode(
          importCapture.node,
        )
        console.log(
          'Import at position',
          importCapture.node.startPosition.row,
          ':',
          {
            name: null,
            source: importSource,
            character: character,
            fullText: importCapture.node.text,
          },
        )

          const fnId = this.generateNodeId(
            'import',
            null,
            filePath,
            importCapture.node.startPosition.row + 1,
            importCapture.node.endPosition.row + 1,
            importCapture.node.startPosition.column + 1,
            importCapture.node.endPosition.column + 1,
          )
          this.graph.setNode(fnId, {
            type: 'import',
            name: null,
            moduleDefinedIn: filePath,
            rowStart: importCapture.node.startPosition.row + 1,
            rowEnd: importCapture.node.endPosition.row + 1,
            columnStart: character,
          })
      }
    }

    // console.log("all import names:", this.getAllImports())
  }

  /**
   * Extract import names from a Tree-sitter match with their character positions
   */
  private extractImportNames(
    match: Parser.QueryMatch,
  ): Array<{ name: string; character: number }> {
    const names: Array<{ name: string; character: number }> = []

    // Look for different types of import name captures
    const captures = match.captures

    for (const capture of captures) {
      switch (capture.name) {
        case 'default_import':
          names.push({
            name: capture.node.text,
            character: capture.node.startPosition.column,
          })
          break
        case 'namespace_import':
          names.push({
            name: capture.node.text,
            character: capture.node.startPosition.column,
          })
          break
        case 'simple_require':
          names.push({
            name: capture.node.text,
            character: capture.node.startPosition.column,
          })
          break
        case 'property_require':
          // Handle require with property access like require('url').parse
          names.push({
            name: capture.node.text,
            character: capture.node.startPosition.column,
          })
          break
        case 'destructured_require':
          // For destructured imports like { validateEmail, log }
          const destructuredNames = this.extractDestructuredNamesWithPositions(
            capture.node,
          )
          names.push(...destructuredNames)
          break
        case 'named_imports_statement':
          // For ES6 named imports
          const namedNames = this.extractNamedImportsWithPositions(capture.node)
          names.push(...namedNames)
          break
        case 'mixed_imports_statement':
          // For ES6 mixed imports (default + named)
          const mixedNames = this.extractMixedImportsWithPositions(capture.node)
          names.push(...mixedNames)
          break
      }
    }

    return names
  }

  /**
   * Extract import source from a Tree-sitter match
   */
  private extractImportSource(match: Parser.QueryMatch): string | null {
    const captures = match.captures

    for (const capture of captures) {
      if (
        capture.name === 'require_source' ||
        capture.name === 'dynamic_source' ||
        capture.name === 'side_effect_import'
      ) {
        // Remove quotes from source
        return capture.node.text.replace(/['"]/g, '')
      }
    }

    // For ES6 imports, find the source in the import statement
    const importCapture = captures.find((c) => c.name === 'import')
    if (importCapture && importCapture.node.type === 'import_statement') {
      // Find the string literal source
      for (let i = 0; i < importCapture.node.namedChildCount; i++) {
        const child = importCapture.node.namedChild(i)
        if (child && child.type === 'string') {
          return child.text.replace(/['"]/g, '')
        }
      }
    }

    return null
  }

  /**
   * Extract names from destructured object pattern like { validateEmail, log } with positions
   */
  private extractDestructuredNamesWithPositions(
    objectPatternNode: Parser.SyntaxNode,
  ): Array<{ name: string; character: number }> {
    const names: Array<{ name: string; character: number }> = []

    // Recursively traverse to handle nested destructuring
    const walkNode = (node: Parser.SyntaxNode) => {
      if (node.type === 'shorthand_property_identifier_pattern') {
        names.push({
          name: node.text,
          character: node.startPosition.column,
        })
      } else if (node.type === 'pair_pattern') {
        // Handle renamed destructured imports like { original: renamed }
        const value = node.namedChild(1)
        if (value) {
          if (value.type === 'identifier') {
            names.push({
              name: value.text,
              character: value.startPosition.column,
            })
          } else if (value.type === 'object_pattern') {
            // Handle nested destructuring like { deep: { nested } }
            walkNode(value)
          }
        }
      } else if (node.type === 'object_pattern') {
        // Handle nested object patterns
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child) {
            walkNode(child)
          }
        }
      }

      // Continue walking for other node types
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type !== 'object_pattern') {
          // Avoid infinite recursion
          walkNode(child)
        }
      }
    }

    walkNode(objectPatternNode)
    return names
  }

  /**
   * Extract names from ES6 named imports like import { x, y as z } with positions
   */
  private extractNamedImportsWithPositions(
    namedImportsNode: Parser.SyntaxNode,
  ): Array<{ name: string; character: number }> {
    const names: Array<{ name: string; character: number }> = []

    // Find the named_imports node within the statement
    const walkNode = (node: Parser.SyntaxNode) => {
      if (node.type === 'import_specifier') {
        // Handle both normal and renamed imports
        const localName = node.namedChild(node.namedChildCount - 1) // Last child is the local name
        if (localName) {
          names.push({
            name: localName.text,
            character: localName.startPosition.column,
          })
        }
      }

      // Recursively check children
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) {
          walkNode(child)
        }
      }
    }

    walkNode(namedImportsNode)
    return names
  }

  /**
   * Extract names from ES6 mixed imports like import React, { useState, useEffect } from 'react'
   */
  private extractMixedImportsWithPositions(
    mixedImportsNode: Parser.SyntaxNode,
  ): Array<{ name: string; character: number }> {
    const names: Array<{ name: string; character: number }> = []

    // Walk through the import clause to find both default and named imports
    const walkNode = (node: Parser.SyntaxNode) => {
      // Handle default import (first identifier in import clause)
      if (node.type === 'identifier' && node.parent?.type === 'import_clause') {
        // Check if this is the default import (not inside named_imports)
        let isInNamedImports = false
        let current = node.parent
        while (current) {
          if (current.type === 'named_imports') {
            isInNamedImports = true
            break
          }
          current = current.parent
        }

        if (!isInNamedImports) {
          names.push({
            name: node.text,
            character: node.startPosition.column,
          })
        }
      }

      // Handle named imports within the mixed import
      if (node.type === 'import_specifier') {
        const localName = node.namedChild(node.namedChildCount - 1)
        if (localName) {
          names.push({
            name: localName.text,
            character: localName.startPosition.column,
          })
        }
      }

      // Recursively check children
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) {
          walkNode(child)
        }
      }
    }

    walkNode(mixedImportsNode)
    return names
  }

  /**
   * Get character position from Tree-sitter node (similar to function extractor)
   */
  private getCharacterFromTreeSitterNode(node: Parser.SyntaxNode): number {
    // For import statements, try to find the identifier or source
    if (node.type === 'import_statement') {
      // Look for import clause first
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === 'import_clause') {
          return child.startPosition.column
        }
      }
    }

    // For require statements, find the identifier being assigned
    if (
      node.type === 'lexical_declaration' ||
      node.type === 'variable_declaration'
    ) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === 'variable_declarator') {
          const name = child.namedChild(0) // First child should be the identifier
          if (name) {
            return name.startPosition.column
          }
        }
      }
    }

    // Fallback to node start position
    return node.startPosition.column
  }

  /**
   * Get all imports from the graph as a structured object
   */
  getAllImports(): Array<{
    nodeId: string
    name: string | null
    module: string
    rowStart: number
    rowEnd: number
    columnStart: number
    type: string
  }> {
    const nodes = this.graph.nodes()
    const importNodes = nodes.filter(nodeId => {
      const nodeData = this.graph.node(nodeId)
      return nodeData && nodeData.type === 'import'
    })

    return importNodes.map(nodeId => {
      const nodeData = this.graph.node(nodeId)
      return {
        nodeId,
        name: nodeData.name,
        module: nodeData.moduleDefinedIn,
        rowStart: nodeData.rowStart,
        rowEnd: nodeData.rowEnd,
        columnStart: nodeData.columnStart,
        type: nodeData.type
      }
    })
  }

}
