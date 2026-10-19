'use client';

import { useParams } from 'next/navigation';
import { Alert, Button, Card, CardBody, PageHeader, Spinner } from '@adapterpay/ui';
import { CopyButton } from '@/components/domain';
import { PlateFrame, PlateQr } from '@/components/plate';
import { useApi } from '@/lib/hooks';

interface PublicQr {
  url: string;
  svg: string;
  pngDataUrl: string;
  /** BR Code estático do POS (qr_response.qr_code). */
  brCode: { value: string; svg: string; pngDataUrl: string } | null;
  nfc: { recordType: string; uri: string };
  storeName: string | null;
  posName: string;
}

/**
 * Placa do POS no modelo AdapterPay (placa.svg): lockup, QR do qr_code do POS, instruções e ícone NFC,
 * com moldura tracejada de recorte. O Mercado Pago aplica o valor da cobrança ativa no QR estático;
 * a tag NFC colada sob o ícone abre a página do caixa.
 */
export default function PlatePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApi<PublicQr>(`/pos/${id}/public-qr`);

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data) return <Spinner className="h-6 w-6 text-brand-600" />;

  const qr = data.brCode ?? { value: data.url, svg: data.svg, pngDataUrl: data.pngDataUrl };
  const svgBlob = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`;

  return (
    <>
      <style>{`@media print { @page { size: A4; margin: 0; } .plate-print { min-height: 297mm; display: flex; align-items: center; justify-content: center; } }`}</style>
      <div className="no-print">
        <PageHeader
          title="Placa do POS e NFC"
          description={`${data.storeName ?? ''} · ${data.posName}`}
          actions={
            <>
              <a href={qr.pngDataUrl} download={`adapterpay-${data.posName}.png`}><Button variant="secondary">Baixar PNG</Button></a>
              <a href={svgBlob} download={`adapterpay-${data.posName}.svg`}><Button variant="secondary">Baixar SVG</Button></a>
              <Button onClick={() => window.print()}>Imprimir placa</Button>
            </>
          }
        />
        {!data.brCode && (
          <Alert tone="warning" className="mb-4" title="Código Pix do POS indisponível">
            Sincronize o POS para trazer o qr_code do Mercado Pago. Até lá, a placa leva à página do caixa.
          </Alert>
        )}
        <Card className="mb-6">
          <CardBody className="space-y-2 text-sm">
            <p className="font-semibold">Gravação da tag NFC</p>
            <p className="text-slate-600">
              Use um app de gravação NFC (ex.: NFC Tools) e grave um registro <strong>NDEF URI</strong> com o endereço abaixo. Ao aproximar o celular, o cliente abre a página de pagamento e usa o botão <em>Copiar código Pix</em>.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{data.nfc.uri}</code>
              <CopyButton text={data.nfc.uri} label="Copiar URI" size="sm" />
            </div>
            <p className="text-xs text-slate-500">Cole a tag sob o ícone de aproximação da placa.</p>
          </CardBody>
        </Card>
      </div>

      <div className="plate-print flex justify-center">
        <div className="w-full max-w-[380px]">
          <PlateFrame className="px-8 pb-8 pt-10">
            <PlateQr value={qr.value} size={230} label="QR Code Pix do caixa" />
            <p className="mt-6 text-balance text-lg font-semibold leading-snug">Aproxime o celular ou leia o QR Code</p>
            <p className="mt-1 text-balance text-sm text-slate-600">Confira o nome da loja e o valor antes de pagar.</p>
          </PlateFrame>
        </div>
      </div>
    </>
  );
}
