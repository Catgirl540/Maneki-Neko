export interface BirthdayPlanInput { contactName: string; relationship: string; eventDate: string; amountCents: number; currency?: string; accountId?: string; confirmed?: boolean; requestId?: string }
export interface BirthdayPlan { id: string; ownerId: string; requestId: string; contactName: string; relationship: string; eventDate: string; amountCents: number; currency: string; accountId: string; reserveAt: string; orderAt: string; expiresAt: string; status: string; notice: string; merchantConnected: boolean; reservation: { status: string; amountCents: number; heldAt: string | null; releasedAt: string | null }; order: { status: string; goods: string[]; dueAt: string; merchantOrderId: null; confirmedAt: string | null }; createdAt: string; updatedAt: string }
export function previewBirthdayPlan(profile: any, input: BirthdayPlanInput, now?: number): Omit<BirthdayPlan, 'id' | 'ownerId' | 'requestId' | 'status' | 'reservation' | 'order' | 'createdAt' | 'updatedAt'>
export function createBirthdayPlan(profile: any, input: BirthdayPlanInput, now?: number): BirthdayPlan
export function advanceBirthdayPlans(profile: any, now?: number): BirthdayPlan[]
export function listBirthdayPlans(profile: any): BirthdayPlan[]
export function cancelBirthdayPlan(profile: any, id: string, input: { confirmed: boolean }, now?: number): BirthdayPlan
export function confirmBirthdayOrder(profile: any, id: string, input: { confirmed: boolean }, now?: number): BirthdayPlan
