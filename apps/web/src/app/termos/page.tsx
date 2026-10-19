import type { Metadata } from 'next';
import { MarketingFooter, MarketingHeader } from '@/components/marketing';

export const metadata: Metadata = { title: 'Termos de uso' };

export default function TermsPage() {
  return (
    <>
      <MarketingHeader />
      <main id="conteudo" className="mx-auto max-w-3xl px-4 py-12">
        <article className="space-y-4 text-sm leading-relaxed text-slate-700">
          <h1 className="text-3xl font-bold tracking-tight text-ink">Termos de uso do AdapterPay</h1>
          <p className="text-xs text-slate-500">Versão vigente a partir de 18/10/2026.</p>
          <h2 className="pt-4 text-lg font-semibold text-ink">1. O serviço</h2>
          <p>
            O AdapterPay, uma plataforma da Adapter Co., é um software por assinatura que ajuda empresas a gerar cobranças Pix presenciais pela integração com a conta Mercado Pago do próprio cliente (lojista). O AdapterPay não é instituição de pagamento, não guarda valores, não intermedia transações e não altera o recebedor dos pagamentos. O dinheiro é recebido diretamente na conta Mercado Pago autorizada pelo lojista.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">2. Assinatura e pagamento</h2>
          <p>
            O cadastro é gratuito. Não há período de teste. O uso operacional começa após a confirmação do pagamento do plano escolhido. Com Pix, uma fatura é emitida a cada ciclo e deve ser paga manualmente. Com cartão, a cobrança é recorrente pelo checkout do Mercado Pago. O AdapterPay não recebe nem armazena dados de cartão.
          </p>
          <p>
            O vencimento é o fim do período pago. Sem pagamento, novas cobranças e a ativação de POS são bloqueadas a partir desse momento, sem tolerância. O acesso ao histórico, às faturas e à conciliação das vendas anteriores continua disponível.
          </p>
          <p>
            Upgrades geram cobrança complementar proporcional ao período restante e são aplicados após a confirmação. Downgrades valem a partir do próximo ciclo e exigem que o uso esteja dentro dos limites do novo plano. O cancelamento impede a renovação e mantém o acesso até o fim do período pago.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">3. Tarifas do Mercado Pago</h2>
          <p>
            O AdapterPay não cobra comissão sobre as vendas. As tarifas de recebimento são definidas no contrato do lojista com o Mercado Pago e podem variar por conta e modalidade. Quando o Mercado Pago informa a tarifa e o valor líquido, eles aparecem nos relatórios. Caso contrário, ficam como não informados.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">4. Responsabilidades do lojista</h2>
          <p>
            O lojista é responsável pela conta Mercado Pago conectada, pelas permissões dadas aos seus usuários, pela conferência dos pagamentos e pelo uso de um POS por caixa, para não misturar cobranças. A confirmação de pagamento só aparece depois que o AdapterPay consulta o Mercado Pago e valida a transação.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">5. Documentos fiscais</h2>
          <p>
            O comprovante gerado pelo AdapterPay é um recibo interno, sem valor fiscal. O AdapterPay não emite NF-e nem NFC-e.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">6. Disponibilidade e limitações</h2>
          <p>
            O serviço depende da disponibilidade das APIs do Mercado Pago. Em caso de falha de comunicação, a cobrança fica em conciliação e não é confirmada até haver resposta segura do provedor.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">7. Contato</h2>
          <p>Dúvidas sobre estes termos podem ser enviadas à Adapter Co. pelos canais informados no site.</p>
        </article>
      </main>
      <MarketingFooter />
    </>
  );
}
