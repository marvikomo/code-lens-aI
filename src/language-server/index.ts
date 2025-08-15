import { TypeScriptLSPClient } from "./typescript-server/lsp-client";

export function getLSPClient(language: string) {
    switch (language) {
        case 'typescript':
            return new TypeScriptLSPClient();
        // Add cases for other languages as needed
        default:
            throw new Error(`Unsupported language: ${language}`);
    }
}