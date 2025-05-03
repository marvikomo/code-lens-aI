import Parser from 'tree-sitter';
import { VariableExtractor } from '../variable-extractor';
import { Neo4jClient } from '../../db/neo4j-client';
import { DbSchema } from '../../db/schema';
import { VariableQuery } from '../../queries/js-query-constants';

// Mock Neo4jClient
jest.mock('../../db/neo4j-client');

describe('VariableExtractor', () => {
  let extractor: VariableExtractor;
  let mockDbClient: jest.Mocked<Neo4jClient>;
  let mockSession: any;
  let parser: Parser;
  let query: Parser.Query;

  beforeEach(() => {
    // Setup mocks
    mockSession = {
      run: jest.fn().mockResolvedValue({}),
    };
    
    mockDbClient = {
      runInTransaction: jest.fn((callback) => callback(mockSession)),
      getSession: jest.fn().mockReturnValue(mockSession),
    } as any;

    // Initialize parser
    parser = new Parser();
    parser.setLanguage(require('tree-sitter-javascript'));
    
    // Create query using the existing VariableQuery
    query = parser.createQuery(VariableQuery);

    extractor = new VariableExtractor(mockDbClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('extract', () => {
    it('should extract const variable declarations', async () => {
      const code = 'const myVar = "test value";';
      const tree = parser.parse(code);
      const filePath = 'test.js';

      await extractor.extract(tree, code, filePath, query);

      // Verify Neo4j calls
      expect(mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining('MERGE (v:Variable {id: $variableId})'),
        expect.objectContaining({
          varName: 'myVar',
          varType: 'const',
          varValue: '"test value"',
          isExported: false
        })
      );
    });

    it('should extract let variable declarations', async () => {
      const code = 'let counter = 0;';
      const tree = parser.parse(code);
      const filePath = 'test.js';

      await extractor.extract(tree, code, filePath, query);

      expect(mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining('MERGE (v:Variable {id: $variableId})'),
        expect.objectContaining({
          varName: 'counter',
          varType: 'let',
          varValue: '0',
          isExported: false
        })
      );
    });

    it('should extract variables without initial values', async () => {
      const code = 'let uninitializedVar;';
      const tree = parser.parse(code);
      const filePath = 'test.js';

      await extractor.extract(tree, code, filePath, query);

      expect(mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining('MERGE (v:Variable {id: $variableId})'),
        expect.objectContaining({
          varName: 'uninitializedVar',
          varType: 'let',
          varValue: '',
          isExported: false
        })
      );
    });

    it('should extract exported variables', async () => {
      const code = 'export const API_KEY = "secret";';
      const tree = parser.parse(code);
      const filePath = 'test.js';

      await extractor.extract(tree, code, filePath, query);

      expect(mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining('MERGE (v:Variable {id: $variableId})'),
        expect.objectContaining({
          varName: 'API_KEY',
          varType: 'const',
          varValue: '"secret"',
          isExported: true
        })
      );
    });

    it('should handle variables in function scope', async () => {
      const code = `
        function test() {
          const localVar = "inside function";
        }
      `;
      const tree = parser.parse(code);
      const filePath = 'test.js';

      await extractor.extract(tree, code, filePath, query);

      expect(mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining('MERGE (v:Variable {id: $variableId})'),
        expect.objectContaining({
          varName: 'localVar',
          varType: 'const',
          varScope: 'function',
          varValue: '"inside function"'
        })
      );
    });

    it('should handle variables in class scope', async () => {
      const code = `
        class TestClass {
          constructor() {
            this.classVar = "class variable";
          }
        }
      `;
      const tree = parser.parse(code);
      const filePath = 'test.js';

      await extractor.extract(tree, code, filePath, query);

      expect(mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining('MERGE (v:Variable {id: $variableId})'),
        expect.objectContaining({
          varName: 'classVar',
          varScope: 'class'
        })
      );
    });

    it('should handle multiple variables in batch', async () => {
      const code = `
        const var1 = "first";
        const var2 = "second";
        const var3 = "third";
      `;
      const tree = parser.parse(code);
      const filePath = 'test.js';

      await extractor.extract(tree, code, filePath, query);

      // Verify that all variables were processed
      expect(mockSession.run).toHaveBeenCalledTimes(3);
    });

    it('should handle errors gracefully', async () => {
      const code = 'const validVar = "test";';
      const tree = parser.parse(code);
      const filePath = 'test.js';

      // Mock an error for the first call
      mockSession.run.mockRejectedValueOnce(new Error('Database error'));

      // Should not throw
      await expect(extractor.extract(tree, code, filePath, query))
        .resolves.not.toThrow();
    });
  });

  describe('determineVariableScope', () => {
    it('should correctly identify module scope', async () => {
      const code = 'const moduleVar = "top level";';
      const tree = parser.parse(code);
      const filePath = 'test.js';

      await extractor.extract(tree, code, filePath, query);

      expect(mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining('MERGE (v:Variable {id: $variableId})'),
        expect.objectContaining({
          varName: 'moduleVar',
          varScope: 'module'
        })
      );
    });

    it('should correctly identify block scope', async () => {
      const code = `
        if (true) {
          let blockVar = "block scope";
        }
      `;
      const tree = parser.parse(code);
      const filePath = 'test.js';

      await extractor.extract(tree, code, filePath, query);

      expect(mockSession.run).toHaveBeenCalledWith(
        expect.stringContaining('MERGE (v:Variable {id: $variableId})'),
        expect.objectContaining({
          varName: 'blockVar',
          varScope: 'block'
        })
      );
    });
  });
});
