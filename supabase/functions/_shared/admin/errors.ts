export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

/** Database functions raise short codes (`raise exception 'reason_required'`). */
const DB_CODES: Record<string, [number, string]> = {
  reason_required: [400, "A reason is required for this action."],
  invalid_amount: [400, "Amount must be a positive whole number (zero or more for 'set')."],
  invalid_op: [400, "Unknown fills operation."],
  invalid_status: [400, "Unknown status."],
  invalid_expiry: [400, "Expiry must be in the future and only applies to grants."],
  invalid_until: [400, "A suspension end must be in the future."],
  invalid_balance: [400, "A balance can only be set when reinstating."],
  unknown_plan: [400, "That plan does not exist or is inactive."],
  user_not_found: [404, "User not found."],
  insufficient_balance: [409, "That is more than the user's current balance."],
};

export function fromDbError(message: string | undefined): ApiError | null {
  if (!message) return null;
  for (const [code, [status, text]] of Object.entries(DB_CODES)) {
    if (message.includes(code)) return new ApiError(status, code, text);
  }
  return null;
}
