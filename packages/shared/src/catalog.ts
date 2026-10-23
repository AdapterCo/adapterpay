/** Carrinho da cobrança rápida: soma e descrição a partir dos itens (preços sempre do servidor). */

export interface CartLine {
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export function cartTotalCents(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

/** "2x Café, 1x Pão de queijo" — cortado em `max` caracteres com reticências. */
export function cartDescription(lines: CartLine[], max = 140): string {
  const text = lines.map((l) => `${l.quantity}x ${l.name}`).join(', ');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
