'use client';

import { PageHeader } from '@adapterpay/ui';
import { SalesReport } from '@/components/sales-report';
import { useSession } from '@/lib/session';

/** Visão do contador: somente leitura das lojas atribuídas, com exportação autorizada. */
export default function ReportsPage() {
  const { me } = useSession();
  return (
    <>
      <PageHeader
        title="Relatórios"
        description={me?.role === 'CONTADOR' ? 'Somente leitura das lojas atribuídas a você.' : 'Pagamentos, histórico e exportação.'}
      />
      <SalesReport showReconciliation={me?.role !== 'VENDEDOR'} />
    </>
  );
}
