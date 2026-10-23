'use client';

import { useState, type FormEvent } from 'react';
import { formatBRL } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { MoneyInput } from '@/components/domain';
import { api, apiUpload, errorMessage } from '@/lib/api';
import { resizeImage } from '@/lib/image';
import { useApi } from '@/lib/hooks';

interface Product {
  id: string;
  name: string;
  code: string | null;
  imageUrl: string | null;
  priceCents: number;
  category: string | null;
  active: boolean;
  sortOrder: number;
}

type Draft = {
  id: string | null;
  name: string;
  code: string;
  priceCents: number | null;
  category: string;
  active: boolean;
  imageUrl: string | null;
  /** foto nova (já reduzida) ou 'remove' para tirar a atual */
  photo: Blob | 'remove' | null;
  preview: string | null;
};
const EMPTY: Draft = { id: null, name: '', code: '', priceCents: null, category: '', active: true, imageUrl: null, photo: null, preview: null };

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
      const body = { name: draft.name, code: draft.code.trim() || null, priceCents: draft.priceCents, category: draft.category.trim() || null, active: draft.active };
      const saved = await api<{ id: string }>(draft.id ? `/products/${draft.id}` : '/products', { method: draft.id ? 'PATCH' : 'POST', body });
      const id = draft.id ?? saved.id;
      if (draft.photo === 'remove') await api(`/products/${id}/image`, { method: 'DELETE' });
      else if (draft.photo) await apiUpload(`/products/${id}/image`, draft.photo);
      if (draft.preview) URL.revokeObjectURL(draft.preview);
      setDraft(null);
      await products.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file || !draft) return;
    setError(null);
    try {
      const blob = await resizeImage(file);
      if (draft.preview) URL.revokeObjectURL(draft.preview);
      setDraft({ ...draft, photo: blob, preview: URL.createObjectURL(blob) });
    } catch (err) {
      setError((err as Error).message);
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
              <tr><Th>Produto</Th><Th>Código</Th><Th>Categoria</Th><Th className="text-right">Preço</Th><Th>Situação</Th><Th className="text-right">Ações</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.data.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-line" loading="lazy" />
                      ) : (
                        <span className="h-10 w-10 shrink-0 rounded-md bg-paper ring-1 ring-line" aria-hidden="true" />
                      )}
                      {p.name}
                    </div>
                  </Td>
                  <Td className="font-mono text-xs text-slate-600">{p.code ?? '—'}</Td>
                  <Td className="text-slate-600">{p.category ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(p.priceCents)}</Td>
                  <Td>{p.active ? <Badge tone="success">À venda</Badge> : <Badge>Pausado</Badge>}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setError(null); setDraft({ id: p.id, name: p.name, code: p.code ?? '', priceCents: p.priceCents, category: p.category ?? '', active: p.active, imageUrl: p.imageUrl, photo: null, preview: null }); }}>Editar</Button>
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
            <div className="flex items-center gap-4">
              {(() => {
                const src = draft.photo === 'remove' ? null : draft.preview ?? draft.imageUrl;
                return src ? (
                  <img src={src} alt="Foto do produto" className="h-20 w-20 rounded-lg object-cover ring-1 ring-line" />
                ) : (
                  <span className="flex h-20 w-20 items-center justify-center rounded-lg bg-paper text-xs text-slate-500 ring-1 ring-line">Sem foto</span>
                );
              })()}
              <div className="flex flex-col items-start gap-1">
                <label className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">
                  {draft.imageUrl || draft.preview ? 'Trocar foto' : 'Adicionar foto'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
                </label>
                {(draft.imageUrl || draft.preview) && draft.photo !== 'remove' && (
                  <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setDraft({ ...draft, photo: 'remove', preview: null })}>
                    Remover foto
                  </button>
                )}
                <p className="text-xs text-slate-500">Aparece no totem. JPEG, PNG ou WebP.</p>
              </div>
            </div>
            <Field label="Código (opcional)" hint="Leia o código de barras com o leitor ou digite um código interno.">
              {(p) => (
                <Input
                  {...p}
                  maxLength={40}
                  autoComplete="off"
                  className="font-mono"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value.replace(/\s/g, '') })}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                />
              )}
            </Field>
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
