import Parser from 'tree-sitter';


import * as fs from 'fs';

import neo4j, { Driver, Session } from 'neo4j-driver';



import { LanguageRegistry } from '../languages/language-registry';




export class TreeSitterParser {
    private parser: Parser;
    private langRegistry: LanguageRegistry;

    constructor(languageRegistry: LanguageRegistry) {

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