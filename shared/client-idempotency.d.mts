export interface ClientOperation { scope: string; fingerprint: string; key: string }
export function createClientOperations(storage: Pick<Storage, 'getItem' | 'setItem'>, cryptoApi?: Crypto): { begin(owner: string, method: string, path: string, body: unknown): Promise<ClientOperation>; finish(operation: ClientOperation): void }
