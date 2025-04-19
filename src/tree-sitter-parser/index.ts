import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

import * as fs from 'fs';
import * as path from 'path';

import {
    createFunctionQuery,
    createVariableQuery,
    createClassQuery,
    createImportQuery,
    createCallQuery
} from '../queries/create-queries';

import { FunctionQuery, CallQuery, ImportQuery, ClassQuery, VariableQuery } from '../queries/js-query-constants';
import { LanguageRegistry } from '../languages/language-registry';

// Create a type for the language instance
type TreeSitterLanguage = Parser.Language & {
    nodeTypeInfo: any;
};


/**
 * Language configuration interface with enhanced queries
 */
interface LanguageConfig {
    extensions: string[];
    parser: Parser;
    queries: {
        functions: Parser.Query;
        calls: Parser.Query;
        imports: Parser.Query;
        exports: Parser.Query;
        classes: Parser.Query;
        variables: Parser.Query;
    };
}



export class TreeSitterParser {
    private parser: Parser;
    private langRegistry: LanguageRegistry;

    constructor(parser: Parser, languageRegistry: LanguageRegistry) {
        this.parser = parser;
        this.langRegistry = languageRegistry;
    }

    public setParser(parser: Parser): void {
        this.parser = parser;
    }

    public getParser(): Parser {
        return this.parser;
    }

    /**
         * Parse a file with the appropriate language parser
         * @param filePath Path to the file
         * @private
         */
    public async parseFile(filePath: string): Promise<any> {
        const language = this.langRegistry.detect(filePath);
        if (!language) {
            console.warn(`Unsupported file type: ${filePath}`);
            return;
        }
        const content = fs.readFileSync(filePath, 'utf8');


        // Parse with Tree-sitter
        const parser = this.langRegistry.get(language).parser;

        let tree = parser.parse(content);
        return {
            language,
            tree,
            content
        }
    }

}