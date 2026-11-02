import type { AaPaymentRequest, AaPaymentInput, SplitCollectionRequest, SplitCollection } from '../app/src/api/types'
export function calculateAaAllocation(input: unknown, members: { amount: number }[]): ReturnType<typeof import('./split-collection.mjs').calculateSplitCollection> | undefined
/** 姓名核对：接受真实姓名、脱敏名与「林女士」称呼写法。 */
export function nameMatches(input: unknown, user: { name?: string; honorific?: string } | null | undefined): boolean
export function normalizeAaMembers(input: unknown): { members: AaMember[]; amount: number }

export interface AaMember { name: string; phone?: string; accountNo?: string; amount: number; memo: string }
export function createAaPayments(options: {
  getDb: () => any; persistRelatedProfiles: (profiles: any[]) => void;
  findProfileByPhone: (phone: string) => any; findProfileByAccountNo?: (accountNo: string) => any; findProfileByUserId: (id: string) => any;
  nextId: (prefix: string) => string; verifyPassword: (password: string) => void | Promise<void>;
  executeTransfer: (request: any) => Promise<any>; now?: () => number;
}): {
  createCollection(input: SplitCollectionRequest): Promise<SplitCollection>;
  listRequests(): Promise<AaPaymentRequest[]>;
  payRequest(id: string, input: AaPaymentInput): Promise<AaPaymentRequest>;
  refreshCollection(collection: any): Promise<void>;
  cancelCollection(collection: any): Promise<SplitCollection>;
}
