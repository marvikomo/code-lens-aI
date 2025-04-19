    import Parser from 'tree-sitter';   
    type TreeSitterLanguage = Parser.Language & {
        nodeTypeInfo: any;
    };
    

    /**
    * Create the function query for Tree-sitter
    * @returns Tree-sitter query for JavaScript functions
    */
    export function createFunctionQuery(language: any, query: any): Parser.Query {

        return new Parser.Query(language as TreeSitterLanguage, query);

    }

    /**
    * Create the variable query for Tree-sitter
    */
    export function createVariableQuery(language: any, query: any): Parser.Query {

        return new Parser.Query(language as TreeSitterLanguage, query);
    }


    /**
     * Create the class query for Tree-sitter
     */
    export function createClassQuery(language: any, query: any): Parser.Query {

        return new Parser.Query(language as TreeSitterLanguage, query);
    }


    /**
    * Create the import query for Tree-sitter
    * @returns Tree-sitter query for JavaScript imports
    */
    export function createImportQuery(language: any, query: any): Parser.Query {

        return new Parser.Query(language as TreeSitterLanguage, query);
    }


    /**
   * Create the call query for Tree-sitter
   * @returns Tree-sitter query for JavaScript calls
   */
    export function createCallQuery(language: any, query: any): Parser.Query {

        return new Parser.Query(language as TreeSitterLanguage, query);
    }
