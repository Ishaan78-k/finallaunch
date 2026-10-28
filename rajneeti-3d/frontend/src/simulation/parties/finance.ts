/** Party funds in crore. Deliberately knows nothing about the government treasury. */
export type MoneyResult = { ok: true; funds: number } | { ok: false; error: string };

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function spendFunds(funds: number, amount: number): MoneyResult {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Amount must be a positive number.' };
  if (amount > funds) return { ok: false, error: 'Not enough party funds.' };
  return { ok: true, funds: round2(funds - amount) };
}

export function receiveFunds(funds: number, amount: number): MoneyResult {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Amount must be a positive number.' };
  return { ok: true, funds: round2(funds + amount) };
}
