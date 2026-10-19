import Link from 'next/link';
import { Button } from '@adapterpay/ui';
import { SIGNATURE, SLOGAN } from '@/components/brand';
import { MarketingFooter, MarketingHeader, PlansGrid } from '@/components/marketing';

const benefits = [
  { title: 'Dinheiro direto na sua conta', text: 'Os pagamentos caem na conta Mercado Pago que você autorizar. O AdapterPay não guarda seu dinheiro nem altera o recebedor.' },
  { title: 'Sem comissão por venda', text: 'Você paga só a mensalidade do plano. O AdapterPay não cobra porcentagem das suas vendas.' },
  { title: 'Você define o valor', text: 'Quem vende digita o valor no painel. O cliente só vê o valor e paga pelo app do banco.' },
  { title: 'Confirmação acompanhada', text: 'O painel mostra o pagamento confirmado em tempo real, consultado direto no Mercado Pago pelo nosso servidor.' },
  { title: 'Várias lojas e caixas', text: 'Organize lojas, POS e equipes com permissões por loja: administrador, vendedor e contador.' },
  { title: 'Relatórios para o contador', text: 'Histórico, conciliação e exportação CSV/XLSX, com tarifa e líquido quando o Mercado Pago informar.' },
];

const faq = [
  { q: 'O cliente precisa instalar algum aplicativo?', a: 'Não. O cliente aproxima o celular da placa NFC ou lê o QR Code, abre a página do AdapterPay e paga com o Pix pelo app do banco que já usa.' },
  { q: 'Para onde vai o dinheiro?', a: 'Direto para a conta Mercado Pago que você conectou. O AdapterPay não faz custódia nem intermediação dos valores.' },
  { q: 'Quanto custa cada Pix?', a: 'O AdapterPay não cobra comissão. As tarifas são as do seu contrato com o Mercado Pago e podem variar por conta e modalidade. Em testes de uma conta específica a tarifa de Pix foi zero, mas isso não é garantido para todas as contas. Quando o Mercado Pago informa a tarifa, ela aparece nos relatórios.' },
  { q: 'Tem período de teste?', a: 'Não. O cadastro é gratuito, mas o uso começa depois do pagamento da primeira mensalidade, por Pix ou cartão.' },
  { q: 'E se a mensalidade vencer?', a: 'Novas cobranças ficam bloqueadas a partir do vencimento até o pagamento. O histórico, as faturas e a conciliação das vendas anteriores continuam disponíveis.' },
  { q: 'O AdapterPay emite nota fiscal?', a: 'Não. O comprovante gerado pelo AdapterPay é um recibo interno, sem valor fiscal.' },
];

export default function LandingPage() {
  return (
    <>
      <MarketingHeader />
      <main id="conteudo">
        <section className="bg-gradient-to-b from-brand-50 to-slate-50">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">Pix presencial com QR Code e NFC</p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">{SLOGAN}</h1>
              <p className="mt-4 max-w-xl text-lg text-slate-600">
                Gere cobranças em segundos, mostre o Pix na placa do caixa e acompanhe a confirmação no painel. O dinheiro vai direto para a sua conta Mercado Pago.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/planos">
                  <Button size="lg">Ver planos e contratar</Button>
                </Link>
                <Link href="/login">
                  <Button size="lg" variant="secondary">Já sou cliente</Button>
                </Link>
              </div>
              <p className="mt-6 text-sm text-slate-500">{SIGNATURE}</p>
            </div>
            <div className="mx-auto w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-lg" aria-hidden="true">
              <p className="text-sm text-slate-500">Padaria Central · Caixa 1</p>
              <p className="mt-2 text-4xl font-bold tabular-nums">R$ 27,50</p>
              <div className="mx-auto mt-5 grid h-44 w-44 grid-cols-8 gap-0.5 rounded-lg bg-white p-2 ring-1 ring-slate-200">
                {Array.from({ length: 64 }).map((_, i) => (
                  <span key={i} className={(i * 7 + (i >> 3)) % 3 === 0 ? 'bg-ink' : 'bg-transparent'} />
                ))}
              </div>
              <div className="mt-5 h-11 rounded-lg bg-brand-600" />
              <p className="mt-3 text-center text-xs text-slate-500">Expira em 02:41</p>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight">Como funciona</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-4">
            {[
              ['Conecte o Mercado Pago', 'Autorize sua conta com segurança (OAuth). Nenhuma senha ou token é digitado no AdapterPay.'],
              ['Cadastre lojas e POS', 'Crie novos caixas no Mercado Pago pelo painel ou importe os que você já usa.'],
              ['Coloque a placa no caixa', 'Imprima o QR e grave a tag NFC com o endereço da página pública do seu POS.'],
              ['Cobre e acompanhe', 'Digite o valor, o cliente paga pelo Pix e o painel mostra a confirmação.'],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-xl border border-slate-200 bg-white p-5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                <h3 className="mt-3 font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-slate-600">{d}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-slate-500">
            A cobrança Pix fica válida por 3 minutos. Cada POS atende uma cobrança por vez. Use um POS por caixa para não misturar pagamentos.
          </p>
        </section>

        <section className="bg-white py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold tracking-tight">Por que AdapterPay</h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {benefits.map((b) => (
                <div key={b.title} className="rounded-xl border border-slate-200 p-5">
                  <h3 className="font-semibold">{b.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{b.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="planos" className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight">Planos</h2>
          <p className="mt-2 text-slate-600">Mensalidade fixa, sem comissão por venda e sem teste grátis. Os limites valem para a empresa inteira.</p>
          <div className="mt-8">
            <PlansGrid />
          </div>
        </section>

        <section className="bg-white py-16">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-2xl font-bold tracking-tight">Perguntas frequentes</h2>
            <div className="mt-6 divide-y divide-slate-200">
              {faq.map((f) => (
                <details key={f.q} className="group py-4">
                  <summary className="cursor-pointer list-none font-medium text-ink marker:hidden">
                    <span className="flex items-center justify-between gap-4">
                      {f.q}
                      <span className="text-slate-400 transition group-open:rotate-45" aria-hidden="true">+</span>
                    </span>
                  </summary>
                  <p className="mt-2 text-sm text-slate-600">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Comece a receber com o AdapterPay</h2>
          <p className="mt-2 text-slate-600">{SLOGAN}</p>
          <Link href="/planos" className="mt-6 inline-block">
            <Button size="lg">Escolher plano</Button>
          </Link>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
