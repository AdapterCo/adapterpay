'use client';

import { useParams } from 'next/navigation';
import { Alert, Button, Card, CardBody, PageHeader, Spinner } from '@adapterpay/ui';
import { LogoMark } from '@/components/brand';
import { CopyButton } from '@/components/domain';
import { useApi } from '@/lib/hooks';

interface PublicQr {
  url: string;
  svg: string;
  pngDataUrl: string;
  nfc: { recordType: string; uri: string };
  storeName: string | null;
  posName: string;
}

/**
 * Placa para impressão: QR da URL PÚBLICA do AdapterPay (não é o BR Code).
 * O cliente abre a página e lá vê o Pix da cobrança ativa.
 */
export default function PlatePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApi<PublicQr>(`/pos/${id}/public-qr`);

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data) return <Spinner className="h-6 w-6 text-brand-600" />;

  const svgBlob = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`;

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Placa do POS e NFC"
          description={`${data.storeName ?? ''} · ${data.posName}`}
          actions={
            <>
              <a href={data.pngDataUrl} download={`adapterpay-${data.posName}.png`}><Button variant="secondary">Baixar PNG</Button></a>
              <a href={svgBlob} download={`adapterpay-${data.posName}.svg`}><Button variant="secondary">Baixar SVG</Button></a>
              <Button onClick={() => window.print()}>Imprimir placa</Button>
            </>
          }
        />
        <Card className="mb-6">
          <CardBody className="space-y-2 text-sm">
            <p className="font-semibold">Gravação da tag NFC</p>
            <p className="text-slate-600">
              Use um app de gravação NFC (ex.: NFC Tools) e grave um registro <strong>NDEF URI</strong> com o endereço abaixo. Não é preciso app próprio: ao aproximar o celular, o cliente abre a página de pagamento e usa o botão <em>Copiar código Pix</em>.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{data.nfc.uri}</code>
              <CopyButton text={data.nfc.uri} label="Copiar URI" size="sm" />
            </div>
            <p className="text-xs text-slate-500">A tag NFC não copia o Pix automaticamente nem abre carteiras digitais. Ela apenas abre a página segura do AdapterPay.</p>
          </CardBody>
        </Card>
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-col items-center rounded-3xl border-2 border-ink bg-white p-8 text-center print:mt-10 print:border-4">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-700">Pague com Pix</p>
        <p className="mt-1 text-2xl font-bold">{data.storeName}</p>
        <p className="text-sm text-slate-600">{data.posName}</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={data.pngDataUrl} alt={`QR Code da página de pagamento ${data.url}`} className="mt-5 h-64 w-64" />
        <p className="mt-4 text-sm font-medium">Aproxime o celular ou leia o QR Code</p>
        <p className="text-xs text-slate-500">Confira o nome da loja e o valor antes de pagar.</p>
        <p className="mt-3 break-all text-[10px] text-slate-400">{data.url}</p>
        <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
          <LogoMark className="h-4 w-4" /> AdapterPay
        </div>
      </div>
    </>
  );
}
