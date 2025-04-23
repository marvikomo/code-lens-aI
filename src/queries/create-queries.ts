    import Parser from 'tree-sitter';   
    type TreeSitterLanguage = Parser.Language & {
        nodeTypeInfo: any;
    };
    

    /**
    * Create the  query for Tree-sitter
    * @returns Tree-sitter query for JavaScript functions
    */
    export function createQuery(language: any, query: any): Parser.Query {

        return new Parser.Query(language as TreeSitterLanguage, query);

    }

   