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
import { FileInfo, ParsedFile } from '../interfaces/file';
import { FunctionQuery, CallQuery, ImportQuery, ClassQuery, VariableQuery } from '../queries/js-query-constants';

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
    private languages: Record<string, LanguageConfig>;

    constructor() {
        this.parser = new Parser();
        this.parser.setLanguage(JavaScript as TreeSitterLanguage);

        // Initialize language configurations
        this.languages = {
            javascript: {
                extensions: ['.js', '.jsx', '.ts', '.tsx'],
                parser: this.parser,
                queries: {
                    functions: createFunctionQuery(JavaScript, FunctionQuery),
                    calls: createCallQuery(JavaScript, CallQuery),
                    imports: createImportQuery(JavaScript, ImportQuery),
                    classes: createClassQuery(JavaScript, ClassQuery),
                    exports: null,
                    variables: createVariableQuery(JavaScript, VariableQuery)
                }
            }
        };

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
        const language = this.detectLanguage(filePath);
        if (!language) {
            console.warn(`Unsupported file type: ${filePath}`);
            return;
        }
        const content = fs.readFileSync(filePath, 'utf8');




        // Parse with Tree-sitter
        const parser = this.languages[language].parser;
        let tree = parser.parse(content);


        return {
            language,
            tree,
            content
        }


    }

    /**
    * Detect language from file path
    * @param filePath Path to the file
    * @returns Language identifier or null if unsupported
    * @private
    */
    private detectLanguage(filePath: string): string | null {
        const ext = path.extname(filePath).toLowerCase();

        for (const [language, config] of Object.entries(this.languages)) {
            if (config.extensions.includes(ext)) {
                return language;
            }
        }

        return null;
    }




}