import type { Metadata } from 'next';
import { MarketingFooter, MarketingHeader, PlansGrid } from '@/components/marketing';

export const metadata: Metadata = { title: 'Planos' };

export default function PlansPage() {
  return (
    <>
      <MarketingHeader />
      <main id="conteudo" className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Planos AdapterPay</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Escolha a capacidade da sua empresa. Os limites de POS, lojas e usuários são somados para toda a empresa. O administrador proprietário conta como usuário.
        </p>
        <div className="mt-8">
          <PlansGrid />
        </div>
        <div className="mt-10 grid gap-4 text-sm text-slate-600 md:grid-cols-3">
          <p><strong className="text-ink">Sem teste grátis.</strong> O cadastro é gratuito e o uso começa após a confirmação do primeiro pagamento.</p>
          <p><strong className="text-ink">Pix ou cartão.</strong> O Pix é pago manualmente a cada mês, com uma nova fatura. O cartão é cobrado automaticamente todo mês.</p>
          <p><strong className="text-ink">Vencimento sem tolerância.</strong> Fatura vencida bloqueia novas cobranças até o pagamento. O histórico continua disponível.</p>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
