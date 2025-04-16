/// <reference types="jest" />

import { CodeLensAI } from '../index';
import * as fs from 'fs';
import * as path from 'path';

// Add type declarations for Jest mocks
jest.mock('fs');
jest.mock('path');

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedPath = path as jest.Mocked<typeof path>;

describe('CodeLensAI', () => {
    let codeLens: CodeLensAI;

    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
        codeLens = new CodeLensAI();
    });

    describe('detectLanguage', () => {
        it('should detect JavaScript files', () => {
            const files = [
                'test.js',
                'test.jsx',
                'test.ts',
                'test.tsx'
            ];

            files.forEach(file => {
                // @ts-ignore - accessing private method for testing
                expect(codeLens.detectLanguage(file)).toBe('javascript');
            });
        });

        it('should return null for unsupported file types', () => {
            const files = [
                'test.py',
                'test.rb',
                'test.java',
                'test.cpp'
            ];

            files.forEach(file => {
                // @ts-ignore - accessing private method for testing
                expect(codeLens.detectLanguage(file)).toBeNull();
            });
        });
    });

    describe('analyze', () => {
        it('should analyze directory and collect files', async () => {
            // Mock filesystem structure
            const mockFiles = [
                'file1.js',
                'file2.ts',
                'file3.tsx',
                'ignored.py'
            ];

            mockedFs.readdirSync.mockReturnValue(
                mockFiles.map(file => ({
                    name: file,
                    isDirectory: () => false,
                    isFile: () => true
                })) as any
            );

            mockedPath.join.mockImplementation((...args) => args.join('/'));

            await codeLens.analyze('/test/dir');

            expect(mockedFs.readdirSync).toHaveBeenCalledWith('/test/dir', { withFileTypes: true });
        });

        it('should ignore specified directories and files', async () => {
            const mockEntries = [
                { name: 'node_modules', isDirectory: () => true, isFile: () => false },
                { name: 'package-lock.json', isDirectory: () => false, isFile: () => true },
                { name: 'src', isDirectory: () => true, isFile: () => false },
                { name: 'index.ts', isDirectory: () => false, isFile: () => true }
            ];

            mockedFs.readdirSync.mockReturnValue(mockEntries as any);

            await codeLens.analyze('/test/dir', {
                ignoreDirs: ['node_modules'],
                ignoreFiles: ['package-lock.json']
            });

            expect(mockedFs.readdirSync).not.toHaveBeenCalledWith(
                expect.stringContaining('node_modules'),
                expect.any(Object)
            );
        });
    });
});
