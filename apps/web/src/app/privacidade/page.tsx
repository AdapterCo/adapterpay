import type { Metadata } from 'next';
import { MarketingFooter, MarketingHeader } from '@/components/marketing';

export const metadata: Metadata = { title: 'Política de privacidade' };

export default function PrivacyPage() {
  return (
    <>
      <MarketingHeader />
      <main id="conteudo" className="mx-auto max-w-3xl px-4 py-12">
        <article className="space-y-4 text-sm leading-relaxed text-slate-700">
          <h1 className="text-3xl font-bold tracking-tight text-ink">Política de privacidade</h1>
          <p className="text-xs text-slate-500">Versão vigente a partir de 18/10/2026. Em conformidade com a LGPD (Lei 13.709/2018).</p>
          <h2 className="pt-4 text-lg font-semibold text-ink">Dados tratados</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Dados da empresa: razão social, nome fantasia e CNPJ/CPF (armazenado cifrado).</li>
            <li>Dados dos usuários: nome, email, senha (armazenada apenas como hash Argon2id), registros de acesso e configurações de autenticação em dois fatores.</li>
            <li>Dados operacionais: lojas, POS, cobranças, valores, identificadores de pedidos e pagamentos do Mercado Pago e registros de auditoria.</li>
            <li>Credenciais de integração: tokens de acesso do Mercado Pago, armazenados cifrados e nunca exibidos no navegador.</li>
          </ul>
          <h2 className="pt-4 text-lg font-semibold text-ink">Clientes finais (compradores)</h2>
          <p>
            O comprador não se cadastra no AdapterPay. As páginas públicas de pagamento não coletam dados pessoais. O AdapterPay guarda apenas os dados da transação retornados pelo Mercado Pago, sem informações de identificação do pagador.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">Finalidades e bases legais</h2>
          <p>
            Prestação do serviço contratado (execução de contrato), segurança e prevenção a fraudes (legítimo interesse) e cumprimento de obrigações legais e regulatórias, inclusive a guarda de registros financeiros.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">Compartilhamento</h2>
          <p>
            Os dados são compartilhados com o Mercado Pago somente no necessário para operar as cobranças e as assinaturas, e com provedores de infraestrutura (hospedagem e email transacional). Não vendemos dados.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">Retenção</h2>
          <p>
            Registros financeiros e trilhas de auditoria são mantidos pelo prazo exigido pela legislação aplicável. Usuários desativados são mantidos por exclusão lógica, para preservar o histórico. Sessões e tokens temporários são removidos periodicamente.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">Direitos do titular</h2>
          <p>
            Você pode solicitar acesso, correção, portabilidade e eliminação dos seus dados, respeitadas as obrigações legais de guarda. Administradores podem exportar os dados da empresa em Configurações › Privacidade.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">Segurança</h2>
          <p>
            Usamos HTTPS obrigatório, criptografia de segredos em repouso, autenticação em dois fatores, controle de acesso por papel e por loja, limitação de tentativas e auditoria de alterações sensíveis.
          </p>
          <h2 className="pt-4 text-lg font-semibold text-ink">Cookies</h2>
          <p>Usamos apenas cookies essenciais: sessão autenticada e proteção contra CSRF. Não usamos cookies de publicidade.</p>
        </article>
      </main>
      <MarketingFooter />
    </>
  );
}
