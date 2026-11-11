// The one reveal: rows 100 ms apart, each highlight shortly after its row, then the new
// PayPal events once every row is in.

export function rowDelayMs(i: number): number {
  return i * 100;
}

export function markDelayMs(i: number): number {
  return i * 100 + 200;
}

export function ledgerDelayMs(rows: number): number {
  return rows * 100 + 600;
}
