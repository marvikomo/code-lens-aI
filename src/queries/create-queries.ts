    import Parser from 'tree-sitter';   
    type TreeSitterLanguage = Parser.Language & {
        nodeTypeInfo: any;
    };
    

    /**
    * Create the JavaScript function query for Tree-sitter
    * @returns Tree-sitter query for JavaScript functions
    */
    export function createFunctionQuery(language: any, query: any): Parser.Query {

        return new Parser.Query(language as TreeSitterLanguage, query);

    }

    /**
    * Create the JavaScript variable query for Tree-sitter
    */
    export function createVariableQuery(language: any, query: any): Parser.Query {

        return new Parser.Query(language as TreeSitterLanguage, query);
    }


    /**
     * Create the JavaScript class query for Tree-sitter
     */
    export function createClassQuery(language: any, query: any): Parser.Query {

        return new Parser.Query(language as TreeSitterLanguage, query);
    }


    /**
    * Create the JavaScript import query for Tree-sitter
    * @returns Tree-sitter query for JavaScript imports
    */
    export function createImportQuery(language: any, query: any): Parser.Query {

        return new Parser.Query(language as TreeSitterLanguage, query);
    }


    /**
   * Create the JavaScript call query for Tree-sitter
   * @returns Tree-sitter query for JavaScript calls
   */
    export function createCallQuery(anguage: any, query: any): Parser.Query {

        return new Parser.Query(anguage as TreeSitterLanguage, query);
    }
