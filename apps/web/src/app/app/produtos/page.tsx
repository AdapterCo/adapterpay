'use client';

import { useState, type FormEvent } from 'react';
import { formatBRL } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { MoneyInput } from '@/components/domain';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Product {
  id: string;
  name: string;
  priceCents: number;
  category: string | null;
  active: boolean;
  sortOrder: number;
}

type Draft = { id: string | null; name: string; priceCents: number | null; category: string; active: boolean };
const EMPTY: Draft = { id: null, name: '', priceCents: null, category: '', active: true };

/** Catálogo da cobrança rápida: o vendedor toca nos produtos e o total é calculado no servidor. */
export default function ProductsPage() {
  const products = useApi<Product[]>('/products');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const categories = [...new Set((products.data ?? []).map((p) => p.category).filter((c): c is string => !!c))];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (!draft.priceCents) return setError('Informe o preço');
    setSaving(true);
    setError(null);
    try {
      const body = { name: draft.name, priceCents: draft.priceCents, category: draft.category.trim() || null, active: draft.active };
      await api(draft.id ? `/products/${draft.id}` : '/products', { method: draft.id ? 'PATCH' : 'POST', body });
      setDraft(null);
      await products.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Product) => {
    if (!window.confirm(`Remover "${p.name}" do catálogo? As vendas antigas continuam com o nome e o preço.`)) return;
    setError(null);
    try {
      await api(`/products/${p.id}`, { method: 'DELETE' });
      await products.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const toggle = async (p: Product) => {
    setError(null);
    try {
      await api(`/products/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
      await products.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Cadastre o que você vende para cobrar com poucos toques em Nova cobrança."
        actions={<Button onClick={() => { setError(null); setDraft({ ...EMPTY }); }}>Novo produto</Button>}
      />
      {error && !draft && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <Card>
        {products.loading && !products.data ? (
          <div className="p-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
        ) : !products.data?.length ? (
          <EmptyState
            title="Nenhum produto no catálogo"
            description="Comece pelos itens mais vendidos. Você pode separar por categoria, como Bebidas ou Lanches."
            action={<Button onClick={() => setDraft({ ...EMPTY })}>Cadastrar o primeiro produto</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr><Th>Produto</Th><Th>Categoria</Th><Th className="text-right">Preço</Th><Th>Situação</Th><Th className="text-right">Ações</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.data.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="text-slate-600">{p.category ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(p.priceCents)}</Td>
                  <Td>{p.active ? <Badge tone="success">À venda</Badge> : <Badge>Pausado</Badge>}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setError(null); setDraft({ id: p.id, name: p.name, priceCents: p.priceCents, category: p.category ?? '', active: p.active }); }}>Editar</Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggle(p)}>{p.active ? 'Pausar' : 'Reativar'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove(p)}>Remover</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)} title={draft?.id ? 'Editar produto' : 'Novo produto'}>
        {draft && (
          <form onSubmit={save} className="flex flex-col gap-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Nome">{(p) => <Input {...p} required maxLength={80} autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
            <Field label="Preço">{(p) => <MoneyInput {...p} key={draft.id ?? 'novo'} valueCents={draft.priceCents} onChange={(c) => setDraft({ ...draft, priceCents: c })} />}</Field>
            <Field label="Categoria (opcional)" hint="Agrupa os produtos na tela de cobrança.">
              {(p) => (
                <>
                  <Input {...p} list="categorias" maxLength={40} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
                  <datalist id="categorias">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                </>
              )}
            </Field>
            <Checkbox checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} label="À venda (aparece em Nova cobrança)" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
              <Button type="submit" loading={saving}>{draft.id ? 'Salvar produto' : 'Cadastrar produto'}</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
