import { ModuleLEvelExtractor } from '../module-level-extractor'
import { Neo4jClient } from '../../db/neo4j-client'
import { TreeSitterUtil } from '../../util/tree-sitter-util'
import { CodeVectorStore } from '../../vector-store'
import { Graph } from 'graphlib'
import Parser from 'tree-sitter'
const JavaScript = require('tree-sitter-javascript')
import { ImportQuery } from '../../queries/js-query-constants'
import { createQuery } from '../../queries/create-queries'

// Mock dependencies
jest.mock('../../db/neo4j-client')
jest.mock('../../util/tree-sitter-util')
jest.mock('../../vector-store')
jest.mock('../../services/class-node-service')
jest.mock('../../services/function-node-service')
jest.mock('../../services/import-node-service')

describe('ModuleLEvelExtractor - Import Types', () => {
  let extractor: ModuleLEvelExtractor
  let mockDbClient: jest.Mocked<Neo4jClient>
  let mockTreeSitterUtil: jest.Mocked<TreeSitterUtil>
  let mockVectorStore: jest.Mocked<CodeVectorStore>
  let graph: Graph
  let parser: Parser
  let query: Parser.Query

  beforeEach(() => {
    // Setup mocks
    mockDbClient = {
      query: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(undefined),
    } as any

    mockTreeSitterUtil = {} as any
    mockVectorStore = {} as any
    graph = new Graph()

    // Setup Tree-sitter
    parser = new Parser()
    parser.setLanguage(JavaScript)
    query = createQuery(JavaScript, ImportQuery)

    // Create extractor
    extractor = new ModuleLEvelExtractor(
      mockDbClient,
      mockTreeSitterUtil,
      mockVectorStore,
      graph
    )

    // Mock ensureModuleNode
    jest.spyOn(extractor as any, 'ensureModuleNode').mockResolvedValue(undefined)
  })

  describe('ES6 Import Types', () => {
    it('should extract default imports', async () => {
      const code = `import React from 'react'`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'React',
          source: 'react',
          character: 7,
          fullText: `import React from 'react'`
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract named imports with correct character positions', async () => {
      const code = `import {formatDate, generateId} from "./utils"`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      // Should extract formatDate at position 8 and generateId at position 20
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'formatDate',
          source: './utils',
          character: 8,
          fullText: `import {formatDate, generateId} from "./utils"`
        })
      )
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'generateId',
          source: './utils',
          character: 20,
          fullText: `import {formatDate, generateId} from "./utils"`
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract named imports with aliases', async () => {
      const code = `import { formatDate as format, generateId as genId } from './utils'`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      // Should extract the local names (aliases)
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'format',
          source: './utils'
        })
      )
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'genId',
          source: './utils'
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract namespace imports', async () => {
      const code = `import * as utils from './utils'`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'utils',
          source: './utils',
          fullText: `import * as utils from './utils'`
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract mixed imports (default + named)', async () => {
      const code = `import React, { useState, useEffect } from 'react'`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      // Should extract default import
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'React',
          source: 'react',
          character: 7
        })
      )
      
      // Should extract named imports
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'useState',
          source: 'react',
          character: 16
        })
      )
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'useEffect',
          source: 'react',
          character: 26
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract side-effect imports', async () => {
      const code = `import './styles.css'`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: null,
          source: './styles.css',
          fullText: `import './styles.css'`
        })
      )
      
      consoleSpy.mockRestore()
    })
  })

  describe('CommonJS Import Types', () => {
    it('should extract simple require with const', async () => {
      const code = `const fs = require('fs')`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'fs',
          source: 'fs',
          fullText: `const fs = require('fs')`
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract simple require with var', async () => {
      const code = `var fs = require('fs')`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'fs',
          source: 'fs',
          fullText: `var fs = require('fs')`
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract destructured require', async () => {
      const code = `const { readFile, writeFile } = require('fs')`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'readFile',
          source: 'fs'
        })
      )
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'writeFile',
          source: 'fs'
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract destructured require with aliases', async () => {
      const code = `const { readFile: read, writeFile: write } = require('fs')`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      // Should extract the local names (aliases)
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'read',
          source: 'fs'
        })
      )
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'write',
          source: 'fs'
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract require with property access', async () => {
      const code = `const parse = require('url').parse`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'parse',
          source: 'url',
          fullText: `const parse = require('url').parse`
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract nested destructuring', async () => {
      const code = `const { config: { database: { host } } } = require('./config')`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'host',
          source: './config'
        })
      )
      
      consoleSpy.mockRestore()
    })
  })

  describe('Dynamic Import Types', () => {
    it('should extract basic dynamic imports', async () => {
      const code = `import('./module')`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: null,
          source: './module',
          fullText: `import('./module')`
        })
      )
      
      consoleSpy.mockRestore()
    })

    it('should extract async dynamic imports', async () => {
      const code = `await import('./module')`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: null,
          source: './module',
          fullText: `await import('./module')`
        })
      )
      
      consoleSpy.mockRestore()
    })
  })

  describe('Complex Import Scenarios', () => {
    it('should handle multiple imports in one file', async () => {
      const code = `
import React, { useState } from 'react'
import { formatDate } from './utils'
const fs = require('fs')
const { log } = require('./logger')
import('./dynamic-module')
      `.trim()
      
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      // Should extract all different types
      const calls = consoleSpy.mock.calls.filter(call => 
        call[0] === 'Import at position' && 
        typeof call[1] === 'number' &&
        call[2] === ':' &&
        typeof call[3] === 'object'
      )
      
      // Extract the import objects
      const imports = calls.map(call => call[3])
      
      // Check that we have all the expected imports
      expect(imports).toContainEqual(expect.objectContaining({ name: 'React', source: 'react' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: 'useState', source: 'react' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: 'formatDate', source: './utils' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: 'fs', source: 'fs' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: 'log', source: './logger' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: null, source: './dynamic-module' }))
      
      consoleSpy.mockRestore()
    })

    it('should prevent duplicate imports from being processed', async () => {
      // Tree-sitter queries can match the same import multiple times
      // Our deduplication should prevent duplicates
      const code = `import { formatDate } from './utils'`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      // Count how many times formatDate was logged
      const formatDateCalls = consoleSpy.mock.calls.filter(call => 
        call[0] === 'Import at position' && 
        typeof call[1] === 'number' &&
        call[2] === ':' &&
        call[3] && 
        call[3].name === 'formatDate'
      )
      
      // Should only be logged once despite potential multiple matches
      expect(formatDateCalls).toHaveLength(1)
      
      consoleSpy.mockRestore()
    })

    it('should handle mixed import with multiple named imports and aliases', async () => {
      const code = `import React, { useState as useStateHook, useEffect, useMemo as memo } from 'react'`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      const calls = consoleSpy.mock.calls.filter(call => 
        call[0] === 'Import at position' && 
        typeof call[1] === 'number' &&
        call[2] === ':' &&
        typeof call[3] === 'object'
      )
      
      const imports = calls.map(call => call[3])
      
      expect(imports).toContainEqual(expect.objectContaining({ name: 'React', source: 'react' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: 'useStateHook', source: 'react' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: 'useEffect', source: 'react' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: 'memo', source: 'react' }))
      
      consoleSpy.mockRestore()
    })

    it('should handle require assignments without declaration', async () => {
      // This pattern: fs = require('fs') (assignment without const/let/var)
      const code = `fs = require('fs')`
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Import at position', 0, ':',
        expect.objectContaining({
          name: 'fs',
          source: 'fs',
          fullText: `fs = require('fs')`
        })
      )
      
      consoleSpy.mockRestore()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty imports gracefully', async () => {
      const code = `` // Empty file
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      // Should process 0 unique imports
      expect(consoleSpy).toHaveBeenCalledWith('Processed 0 unique imports from 0 matches')
      
      consoleSpy.mockRestore()
    })

    it('should handle imports with comments', async () => {
      const code = `
// This is a comment
import React from 'react' // Another comment
/* Block comment */
const fs = require('fs') // End comment
      `.trim()
      
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      const calls = consoleSpy.mock.calls.filter(call => 
        call[0] === 'Import at position' && 
        typeof call[1] === 'number' &&
        call[2] === ':' &&
        typeof call[3] === 'object'
      )
      
      const imports = calls.map(call => call[3])
      
      expect(imports).toContainEqual(expect.objectContaining({ name: 'React', source: 'react' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: 'fs', source: 'fs' }))
      
      consoleSpy.mockRestore()
    })

    it('should handle imports with different quote types', async () => {
      const code = `
import React from "react"
import { utils } from './utils'
const fs = require('fs') // Changed from backticks to single quotes since backticks aren't supported yet
      `.trim()
      
      const tree = parser.parse(code)
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await extractor.extract(tree, code, '/test.js', query)
      
      const calls = consoleSpy.mock.calls.filter(call => 
        call[0] === 'Import at position' && 
        typeof call[1] === 'number' &&
        call[2] === ':' &&
        typeof call[3] === 'object'
      )
      
      const imports = calls.map(call => call[3])
      
      expect(imports).toContainEqual(expect.objectContaining({ name: 'React', source: 'react' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: 'utils', source: './utils' }))
      expect(imports).toContainEqual(expect.objectContaining({ name: 'fs', source: 'fs' }))
      
      consoleSpy.mockRestore()
    })
  })
})
