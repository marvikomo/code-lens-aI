import * as path from 'path';
import { LanguageConfig } from '../interfaces/code';

export class LanguageRegistry {
    private supportedLanguages: Record<string, LanguageConfig>;

    constructor() {
        this.supportedLanguages = {};
    }

    /**
     * Register a new language configuration
     */
    register(name: string, config: LanguageConfig): void {
        this.supportedLanguages[name] = config;
    }

    /**
     * Get language configuration by name
     */
    get(name: string): LanguageConfig | undefined {
        return this.supportedLanguages[name];
    }

    /**
     * Detect language based on file extension
     */
    detect(filePath: string): string | null {
        const ext = path.extname(filePath).toLowerCase();

        for (const [lang, config] of Object.entries(this.supportedLanguages)) {
            if (config.extensions.includes(ext)) {
                return lang;
            }
        }

        return null;
    }

    /**
     * List all supported languages
     */
    list(): string[] {
        return Object.keys(this.supportedLanguages);
    }
}