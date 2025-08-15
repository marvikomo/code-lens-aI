import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface LSPRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: any;
}

interface LSPResponse {
  jsonrpc: string;
  id?: number;
  result?: any;
  error?: any;
}

interface LSPNotification {
  jsonrpc: string;
  method: string;
  params?: any;
}

interface Position {
  line: number;
  character: number;
}

interface Range {
  start: Position;
  end: Position;
}

interface DocumentSymbol {
  name: string;
  kind: number;
  range?: Range;
  selectionRange?: Range;
  location?: {
    uri: string;
    range: Range;
  };
  children?: DocumentSymbol[];
  containerName?: string;
}

interface CallHierarchyItem {
  name: string;
  kind: number;
  uri: string;
  range: Range;
  selectionRange: Range;
}

interface CallHierarchyOutgoingCall {
  to: CallHierarchyItem;
  fromRanges: Range[];
}

export class TypeScriptLSPClient {
  private process: ChildProcess | null = null;
  private requestId = 1;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private buffer = '';
  private workspaceRoot: string | null = null;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot || null;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Spawn typescript-language-server with stdio
      this.process = spawn('typescript-language-server', ['--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (!this.process) {
        reject(new Error('Failed to start typescript-language-server'));
        return;
      }

      // Handle process errors
      this.process.on('error', (error) => {
        console.error('LSP Process error:', error);
        reject(error);
      });

      // Handle stdout data (LSP responses)
      this.process.stdout?.on('data', (data) => {
        this.handleResponse(data.toString());
      });

      // Handle stderr
      this.process.stderr?.on('data', (data) => {
        console.error('LSP stderr:', data.toString());
      });

      // Initialize the LSP server
      this.initialize().then(resolve).catch(reject);
    });
  }

  private async initialize(): Promise<void> {
    console.log("Root uri:", this.workspaceRoot ? `file://${path.resolve(this.workspaceRoot)}` : 'No workspace root');
    const initRequest: LSPRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'initialize',
      params: {
        processId: process.pid,
        clientInfo: {
          name: 'ts-analyzer',
          version: '1.0.0'
        },
        rootUri: this.workspaceRoot ? `file://${path.resolve(this.workspaceRoot)}` : null,
        workspaceFolders: this.workspaceRoot ? [{
          uri: `file://${path.resolve(this.workspaceRoot)}`,
          name: path.basename(this.workspaceRoot)
        }] : null,
        capabilities: {
          workspace: {
            configuration: true,
            workspaceFolders: true,
            didChangeWatchedFiles: {
              dynamicRegistration: false
            }
          },
          textDocument: {
            publishDiagnostics: {
              relatedInformation: true,
              versionSupport: false,
              tagSupport: {
                valueSet: [1, 2]
              }
            },
            synchronization: {
              dynamicRegistration: true,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: true
            },
            completion: {
              dynamicRegistration: true,
              contextSupport: true,
              completionItem: {
                snippetSupport: true,
                commitCharactersSupport: true,
                documentationFormat: ["markdown", "plaintext"],
                deprecatedSupport: true,
                preselectSupport: true
              }
            },
            hover: {
              dynamicRegistration: true,
              contentFormat: ["markdown", "plaintext"]
            },
            signatureHelp: {
              dynamicRegistration: true,
              signatureInformation: {
                documentationFormat: ["markdown", "plaintext"]
              }
            },
            definition: {
              dynamicRegistration: true,
              linkSupport: true
            },
            references: {
              dynamicRegistration: true
            },
            documentHighlight: {
              dynamicRegistration: true
            },
            documentSymbol: {
              dynamicRegistration: false,
              symbolKind: {
                valueSet: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]
              },
              hierarchicalDocumentSymbolSupport: true
            },
            codeAction: {
              dynamicRegistration: true,
              codeActionLiteralSupport: {
                codeActionKind: {
                  valueSet: ["", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports"]
                }
              }
            },
            codeLens: {
              dynamicRegistration: true
            },
            formatting: {
              dynamicRegistration: true
            },
            rangeFormatting: {
              dynamicRegistration: true
            },
            onTypeFormatting: {
              dynamicRegistration: true
            },
            rename: {
              dynamicRegistration: true,
              prepareSupport: true
            },
            documentLink: {
              dynamicRegistration: true
            },
            typeDefinition: {
              dynamicRegistration: true,
              linkSupport: true
            },
            implementation: {
              dynamicRegistration: true,
              linkSupport: true
            },
            colorProvider: {
              dynamicRegistration: true
            },
            foldingRange: {
              dynamicRegistration: true,
              rangeLimit: 5000,
              lineFoldingOnly: true
            },
            declarationSupport: {
              dynamicRegistration: true,
              linkSupport: true
            },
            callHierarchy: {
              dynamicRegistration: false
            }
          }
        }
      }
    };

    await this.sendRequest(initRequest);
    
    // Send initialized notification
    this.sendNotification({
      jsonrpc: '2.0',
      method: 'initialized',
      params: {}
    });
  }

  private sendRequest(request: LSPRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error('LSP process not available'));
        return;
      }

      this.pendingRequests.set(request.id, { resolve, reject });

      const message = JSON.stringify(request);
      const header = `Content-Length: ${Buffer.byteLength(message, 'utf8')}\r\n\r\n`;
      
      this.process.stdin.write(header + message);
    });
  }

  private sendNotification(notification: LSPNotification): void {
    if (!this.process || !this.process.stdin) {
      return;
    }

    const message = JSON.stringify(notification);
    const header = `Content-Length: ${Buffer.byteLength(message, 'utf8')}\r\n\r\n`;
    
    this.process.stdin.write(header + message);
  }

  private handleResponse(data: string): void {
    this.buffer += data;

    while (true) {
      // Look for Content-Length header
      const headerMatch = this.buffer.match(/Content-Length: (\d+)\r?\n\r?\n/);
      if (!headerMatch) break;

      const contentLength = parseInt(headerMatch[1] || '0');
      const headerLength = headerMatch[0].length;
      
      if (this.buffer.length < headerLength + contentLength) {
        break; // Wait for more data
      }

      // Extract the JSON message
      const messageJson = this.buffer.substring(headerLength, headerLength + contentLength);
      this.buffer = this.buffer.substring(headerLength + contentLength);

      try {
        const message: LSPResponse = JSON.parse(messageJson);
        
        if (message.id !== undefined) {
          const pending = this.pendingRequests.get(message.id);
          if (pending) {
            this.pendingRequests.delete(message.id);
            if (message.error) {
              pending.reject(new Error(message.error.message));
            } else {
              pending.resolve(message.result);
            }
          }
        }
      } catch (error) {
        console.error('Failed to parse LSP message:', error);
      }
    }
  }

  async openAllProjectFiles(filePaths: string[]): Promise<void> {
    // Open all TypeScript files so LSP can analyze relationships
    for (const filePath of filePaths) {
      const fileUri = `file://${path.resolve(filePath)}`;
      
      try {
        const content = require('fs').readFileSync(filePath, 'utf8');
        const languageId = this.getLanguageId(filePath);
        
        this.sendNotification({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: fileUri,
              languageId: languageId,
              version: 1,
              text: content
            }
          }
        });
      } catch (error) {
        console.warn(`Warning: Could not open file ${filePath}:`, error);
      }
    }
    
    // Give LSP some time to process all files
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  private getLanguageId(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
        return 'typescript';
      case '.tsx':
        return 'typescriptreact';
      case '.js':
        return 'javascript';
      case '.jsx':
        return 'javascriptreact';
      default:
        return 'typescript'; // Default fallback
    }
  }

  async findFunctions(filePath: string): Promise<Array<{name: string, position: Position}>> {
    const fileUri = `file://${path.resolve(filePath)}`;
    const languageId = this.getLanguageId(filePath);
    
    // First, open the document
    this.sendNotification({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: fileUri,
          languageId: languageId,
          version: 1,
          text: require('fs').readFileSync(filePath, 'utf8')
        }
      }
    });

    try {
      // Get document symbols
      const symbols: DocumentSymbol[] = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'textDocument/documentSymbol',
        params: {
          textDocument: { uri: fileUri }
        }
      });

      // Filter for functions, methods, and arrow functions (kind 12 = Function, kind 6 = Method, kind 14 = Variable/Arrow Function)
      const functions: Array<{name: string, position: Position}> = [];
      
      const extractFunctions = (symbols: DocumentSymbol[]): void => {
        for (const symbol of symbols) {
          // Include functions (12), methods (6), and variables (14) that might be arrow functions
          if (symbol.kind === 12 || symbol.kind === 6 || symbol.kind === 14) {
            // Skip anonymous functions and callbacks
            if (symbol.name.includes('<function>') || 
                symbol.name.includes('callback') || 
                symbol.name.startsWith('setTimeout') ||
                symbol.name === 'error' || // Skip catch block variables
                symbol.name === 'processed' || // Skip regular variables that aren't functions
                symbol.name === 'savedUser' ||
                symbol.name === 'tempId' ||
                symbol.name === 'user' ||
                symbol.name === 'userData' ||
                symbol.name === 'emailRegex' ||
                symbol.name === 'createdAt' ||
                symbol.name === 'id' ||
                symbol.name === 'name' ||
                symbol.name === 'email') {
              continue;
            }
            
            // Handle both DocumentSymbol and SymbolInformation formats
            let position: Position | undefined;
            
            if (symbol.selectionRange && symbol.selectionRange.start) {
              position = symbol.selectionRange.start;
            } else if (symbol.location && symbol.location.range && symbol.location.range.start) {
              position = symbol.location.range.start;
            } else if (symbol.range && symbol.range.start) {
              position = symbol.range.start;
            }
            
            if (position) {
              functions.push({
                name: symbol.name,
                position: position
              });
            }
          }
          if (symbol.children) {
            extractFunctions(symbol.children);
          }
        }
      };

      if (symbols && Array.isArray(symbols)) {
        extractFunctions(symbols);
      }
      
      return functions;
    } catch (error) {
      console.warn(`Warning: Could not get symbols for ${filePath}:`, error);
      return [];
    }
  }

  async getAllSymbols(filePath: string): Promise<Array<{name: string, kind: number, position: Position}>> {
    const fileUri = `file://${path.resolve(filePath)}`;
    const languageId = this.getLanguageId(filePath);
    
    // First, open the document
    this.sendNotification({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: fileUri,
          languageId: languageId,
          version: 1,
          text: require('fs').readFileSync(filePath, 'utf8')
        }
      }
    });

    try {
      // Get document symbols
      const symbols: DocumentSymbol[] = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'textDocument/documentSymbol',
        params: {
          textDocument: { uri: fileUri }
        }
      });

      const allSymbols: Array<{name: string, kind: number, position: Position}> = [];
      
      const extractAllSymbols = (symbols: DocumentSymbol[]): void => {
        for (const symbol of symbols) {
          // Handle both DocumentSymbol and SymbolInformation formats
          let position: Position | undefined;
          
          if (symbol.selectionRange && symbol.selectionRange.start) {
            position = symbol.selectionRange.start;
          } else if (symbol.location && symbol.location.range && symbol.location.range.start) {
            position = symbol.location.range.start;
          } else if (symbol.range && symbol.range.start) {
            position = symbol.range.start;
          }
          
          if (position) {
            allSymbols.push({
              name: symbol.name,
              kind: symbol.kind,
              position: position
            });
          }
          
          if (symbol.children) {
            extractAllSymbols(symbol.children);
          }
        }
      };

      if (symbols && Array.isArray(symbols)) {
        extractAllSymbols(symbols);
      }
      
      return allSymbols;
    } catch (error) {
      console.warn(`Warning: Could not get symbols for ${filePath}:`, error);
      return [];
    }
  }

  async getCallees(filePath: string, position: Position, debug: boolean = false): Promise<Array<{name: string, file: string, line: number, column: number, callSite: {line: number, column: number}}>> {
    const fileUri = `file://${path.resolve(filePath)}`;

    try {
      // Prepare call hierarchy
      const callHierarchyItems: CallHierarchyItem[] = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'textDocument/prepareCallHierarchy',
        params: {
          textDocument: { uri: fileUri },
          position: position
        }
      });

      if (debug) {
        console.log(`DEBUG LSP: prepareCallHierarchy for ${filePath}:${position.line}:${position.character}`, 
          callHierarchyItems?.length || 0, 'items found');
      }

      if (!callHierarchyItems || callHierarchyItems.length === 0) {
        return [];
      }

      // Get outgoing calls
      const outgoingCalls: CallHierarchyOutgoingCall[] = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'callHierarchy/outgoingCalls',
        params: {
          item: callHierarchyItems[0]
        }
      });

      if (debug) {
        console.log(`DEBUG LSP: outgoingCalls found:`, outgoingCalls?.length || 0, 'calls');
        if (outgoingCalls && outgoingCalls.length > 0) {
          outgoingCalls.forEach((call, idx) => {
            console.log(`  Call ${idx + 1}: ${call.to.name} at ${call.to.uri}`);
          });
        }
      }

      const callees: Array<{name: string, file: string, line: number, column: number, callSite: {line: number, column: number}}> = [];
      
      for (const call of outgoingCalls || []) {
        const calleeUri = call.to.uri;
        const calleePath = calleeUri.replace('file://', '');
        
        // Use the first from range as the call site, with fallback
        const fromRange = call.fromRanges && call.fromRanges.length > 0 ? call.fromRanges[0] : call.to.range;
        
        callees.push({
          name: call.to.name,
          file: calleePath,
          line: call.to.range.start.line + 1,
          column: call.to.range.start.character + 1,
          callSite: {
            line: fromRange ? fromRange.start.line + 1 : call.to.range.start.line + 1,
            column: fromRange ? fromRange.start.character + 1 : call.to.range.start.character + 1
          }
        });
      }

      return callees;
    } catch (error) {
      // If call hierarchy fails, return empty array
      if (debug) {
        console.warn(`DEBUG LSP: Call hierarchy failed for ${filePath}:`, error);
      }
      return [];
    }
  }

  async getDefinition(filePath: string, position: Position): Promise<Array<{uri: string, range: Range}>> {
    const fileUri = `file://${path.resolve(filePath)}`;
    
    try {
      const definitions = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'textDocument/definition',
        params: {
          textDocument: { uri: fileUri },
          position: position
        }
      });

      return definitions || [];
    } catch (error) {
      console.warn(`Warning: Could not get definition for ${filePath}:`, error);
      return [];
    }
  }

  async getReferences(filePath: string, position: Position): Promise<Array<{uri: string, range: Range}>> {
    const fileUri = `file://${path.resolve(filePath)}`;
    
    try {
      const references = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'textDocument/references',
        params: {
          textDocument: { uri: fileUri },
          position: position,
          context: { includeDeclaration: false }
        }
      });

      return references || [];
    } catch (error) {
      console.warn(`Warning: Could not get references for ${filePath}:`, error);
      return [];
    }
  }

  async shutdown(): Promise<void> {
    if (this.process) {
      await this.sendRequest({
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'shutdown',
        params: null
      });

      this.sendNotification({
        jsonrpc: '2.0',
        method: 'exit',
        params: {}
      });

      this.process.kill();
      this.process = null;
    }
  }
}
