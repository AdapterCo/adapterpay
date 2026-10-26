import type { Prisma } from '@adapterpay/database';
import { formatBRL, type ChargeStatus } from '@adapterpay/shared';
import { createNotification } from '../notifications';

/**
 * Modo Restaurante: cada cobrança paga de uma mesa soma na conta, na MESMA transação da confirmação.
 * Conta 100% paga é fechada e a mesa fica livre. Roda dentro de applyChargeTransition.
 */
export async function applyTableBillOnTransition(
  tx: Prisma.TransactionClient,
  charge: { id: string; tenantId: string; amountCents: number; tableBillId: string | null },
  previous: ChargeStatus,
  target: ChargeStatus,
): Promise<void> {
  if (!charge.tableBillId || target !== 'PAID' || previous === 'PAID') return;

  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM table_bills WHERE id = ${charge.tableBillId}::uuid FOR UPDATE`;
  if (!rows[0]) return;
  const bill = await tx.tableBill.findUniqueOrThrow({ where: { id: charge.tableBillId }, include: { table: { select: { name: true } } } });

  if (bill.status !== 'OPEN') {
    // Pix pago depois de a conta já estar fechada (pagamento atrasado de uma parte expirada).
    await createNotification(tx, null, {
      tenantId: charge.tenantId,
      kind: 'table.overpaid',
      title: `${bill.table.name}: pagamento após o fechamento`,
      body: `Um Pix de ${formatBRL(charge.amountCents)} da ${bill.table.name} foi confirmado depois de a conta estar fechada. Confira se é preciso devolver.`,
      link: `/app/cobrancas/${charge.id}`,
    });
    return;
  }

  const paidCents = bill.paidCents + charge.amountCents;
  const paid = paidCents >= bill.totalCents;
  await tx.tableBill.update({
    where: { id: bill.id },
    data: {
      paidCents,
      paidShares: bill.mode === 'SPLIT' ? { increment: 1 } : bill.paidShares,
      ...(paid ? { status: 'PAID', closedAt: new Date() } : {}),
    },
  });
  if (paid) {
    await createNotification(tx, null, {
      tenantId: charge.tenantId,
      kind: 'table.paid',
      title: `${bill.table.name} paga`,
      body: `A conta de ${formatBRL(bill.totalCents)} da ${bill.table.name} foi 100% paga. A mesa está livre.`,
      link: '/app/mesas',
    });
  }
}
