'use client';

import { PageHeader } from '@adapterpay/ui';
import { SalesReport } from '@/components/sales-report';

export default function FinancePage() {
  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Recebimentos, conciliação, divergências, estornos e exportação. As vendas entram na conta Mercado Pago da loja, separadas das cobranças da assinatura AdapterPay."
      />
      <SalesReport showReconciliation />
    </>
  );
}
