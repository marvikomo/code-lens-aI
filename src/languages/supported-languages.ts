import * as path from 'path';
import { TreeSitterParser } from '../tree-sitter-parser';
import { createFunctionQuery, createCallQuery, createImportQuery, createClassQuery, createVariableQuery } from '../queries/create-queries';
import { FunctionQuery, CallQuery, ImportQuery, ClassQuery, VariableQuery } from '../queries/js-query-constants';


const parser = new TreeSitterParser().getParser();

export const supportedLanguages: Record<string, any> = {
    javascript: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        parser: parser,
        queries: {
            functions: createFunctionQuery(parser.getLanguage(), FunctionQuery),
            calls: createCallQuery(parser.getLanguage(), CallQuery),
            imports: createImportQuery(parser.getLanguage(), ImportQuery),
            classes: createClassQuery(parser.getLanguage(), ClassQuery),
            exports: null,
            variables: createVariableQuery(parser.getLanguage(), VariableQuery)
        }
    }
}

/**
   * Detect language from file path
   * @param filePath Path to the file
   * @returns Language identifier or null if unsupported
   */
export function detectLanguage(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();

    for (const [lang, config] of Object.entries(supportedLanguages)) {
        if (config.extensions.includes(ext)) {
            return lang;
        }
    }

    return null;
}