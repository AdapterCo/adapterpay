'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Button, PageHeader } from '@adapterpay/ui';
import { PlateFrame, PlateQr } from '@/components/plate';

/** Placa da mesa: o QR abre a página da mesa (o cliente escolhe pagar integral ou dividido). */
function TablePlate() {
  const params = useSearchParams();
  const slug = params.get('slug') ?? '';
  const name = params.get('nome') ?? 'Mesa';
  const url = typeof window !== 'undefined' ? `${window.location.origin}/mesa/${slug}` : '';

  return (
    <>
      <style>{`@media print { @page { size: A4; margin: 0; } .plate-print { min-height: 297mm; display: flex; align-items: center; justify-content: center; } }`}</style>
      <div className="no-print">
        <PageHeader title={`Placa · ${name}`} description="Imprima e deixe na mesa. O cliente escaneia para pagar a conta." actions={<Button onClick={() => window.print()}>Imprimir placa</Button>} />
      </div>
      <div className="plate-print flex justify-center">
        <div className="w-full max-w-[380px]">
          <PlateFrame className="px-8 pb-8 pt-10" footer={false}>
            <p className="text-4xl font-semibold text-ink">{name}</p>
            <div className="mt-5">{url && <PlateQr value={url} size={230} label={`QR Code da ${name}`} />}</div>
            <p className="mt-6 text-balance text-lg font-semibold leading-snug">Pague a conta pelo celular</p>
            <p className="mt-1 text-balance text-sm text-slate-600">Escaneie, escolha integral ou dividido e pague por Pix.</p>
          </PlateFrame>
        </div>
      </div>
    </>
  );
}

export default function TablePlatePage() {
  return (
    <Suspense>
      <TablePlate />
    </Suspense>
  );
}
