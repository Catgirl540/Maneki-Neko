import type { AaPaymentRequest, AaPaymentInput, SplitCollectionRequest, SplitCollection } from '../app/src/api/types'
export function calculateAaAllocation(input: unknown, members: { amount: number }[]): ReturnType<typeof import('./split-collection.mjs').calculateSplitCollection> | undefined
export function normalizeAaMembers(input: unknown): { members: { phone: string; amount: number; memo: string }[]; amount: number }
export function createAaPayments(options: {
  getDb: () => any; persistRelatedProfiles: (profiles: any[]) => void;
  findProfileByPhone: (phone: string) => any; findProfileByUserId: (id: string) => any;
  nextId: (prefix: string) => string; verifyPassword: (password: string) => void | Promise<void>;
  executeTransfer: (request: any) => Promise<any>; now?: () => number;
}): {
  createCollection(input: SplitCollectionRequest): Promise<SplitCollection>;
  listRequests(): Promise<AaPaymentRequest[]>;
  payRequest(id: string, input: AaPaymentInput): Promise<AaPaymentRequest>;
  refreshCollection(collection: any): Promise<void>;
  cancelCollection(collection: any): Promise<SplitCollection>;
}
