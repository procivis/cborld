declare module '@procivis/cborld' {

    function encode(params: {
        jsonldDocument: object;
        documentLoader: (url: string) => Promise<{ document: string }>;
        registryEntryId?: number | 'legacy';
        typeTable?: Map<string, any>,
        diagnose?: (message: string) => void;
        appContextMap?: Map<string, any>;
        compressionMode?: number;
    }): Promise<Uint8Array>;

    function decode(params: {
        cborldBytes: Uint8Array;
        documentLoader: (url: string) => Promise<{ document: string }>;
        typeTable?: Map<string, any>,
        diagnose?: (message: string) => void;
        appContextMap?: Map<string, any>;
    }): Promise<object>;
}