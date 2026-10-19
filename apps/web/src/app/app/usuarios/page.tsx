'use client';

import { useState, type FormEvent } from 'react';
import { ROLE_LABELS, TENANT_ROLES, type TenantRole } from '@adapterpay/shared';
import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@adapterpay/ui';
import { useCritical } from '@/components/critical';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Member {
  userId: string;
  email: string;
  name: string;
  role: TenantRole;
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  isOwner: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  storeIds: 'ALL' | string[];
}

const STATUS = { ACTIVE: ['Ativo', 'success'], INVITED: ['Convidado', 'info'], DISABLED: ['Desativado', 'neutral'] } as const;

export default function UsersPage() {
  const { me } = useSession();
  const critical = useCritical();
  const users = useApi<Member[]>('/users');
  const stores = useApi<Array<{ id: string; name: string }>>('/stores');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Member | null>(null);
  const [form, setForm] = useState<{ email: string; name: string; role: TenantRole; storeIds: string[] }>({ email: '', name: '', role: 'VENDEDOR', storeIds: [] });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await critical(() => api('/users/invite', { method: 'POST', body: form }));
      setOpen(false);
      setMsg(`Convite enviado para ${form.email}.`);
      setForm({ email: '', name: '', role: 'VENDEDOR', storeIds: [] });
      await users.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const save = async (patch: { role?: TenantRole; status?: 'ACTIVE' | 'DISABLED'; storeIds?: string[] }, userId: string) => {
    setSaving(true);
    setError(null);
    try {
      await critical(() => api(`/users/${userId}`, { method: 'PATCH', body: patch }));
      setEdit(null);
      await users.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const storeName = (id: string) => stores.data?.find((s) => s.id === id)?.name ?? id.slice(0, 8);

  const StorePicker = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium">Lojas autorizadas</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {stores.data?.map((s) => (
          <Checkbox key={s.id} checked={value.includes(s.id)} onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))} label={s.name} />
        ))}
      </div>
    </fieldset>
  );

  return (
    <>
      <PageHeader title="Usuários e permissões" description="Convide administradores, vendedores e contadores. Desativar não apaga o histórico." actions={<Button onClick={() => setOpen(true)}>Convidar usuário</Button>} />
      {msg && <Alert tone="success" className="mb-4">{msg}</Alert>}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <Card>
        {!users.data ? (
          <div className="p-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
        ) : (
          <Table>
            <thead><tr><Th>Usuário</Th><Th>Papel</Th><Th>Lojas</Th><Th>Status</Th><Th>MFA</Th><Th>Último acesso</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {users.data.map((u) => (
                <tr key={u.userId}>
                  <Td><p className="font-medium text-ink">{u.name}{u.isOwner && <Badge tone="brand" className="ml-2">Proprietário</Badge>}</p><p className="text-xs text-slate-500">{u.email}</p></Td>
                  <Td>{ROLE_LABELS[u.role]}</Td>
                  <Td className="whitespace-normal text-xs">{u.storeIds === 'ALL' ? 'Todas' : u.storeIds.map(storeName).join(', ') || '—'}</Td>
                  <Td><Badge tone={STATUS[u.status][1]}>{STATUS[u.status][0]}</Badge></Td>
                  <Td>{u.mfaEnabled ? <Badge tone="success">Ativo</Badge> : <span className="text-xs text-slate-400">—</span>}</Td>
                  <Td className="text-xs">{formatDateTime(u.lastLoginAt)}</Td>
                  <Td className="text-right">
                    {!u.isOwner && u.userId !== me?.user.id && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEdit(u)}>Editar</Button>
                        <Button size="sm" variant="ghost" onClick={() => save({ status: u.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' }, u.userId)}>
                          {u.status === 'DISABLED' ? 'Reativar' : 'Desativar'}
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen} title="Convidar usuário" description="Convites pendentes ocupam uma vaga do plano.">
        <form onSubmit={invite} className="flex flex-col gap-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Nome">{(p) => <Input {...p} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label="Email">{(p) => <Input {...p} required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
          <Field label="Papel">
            {(p) => (
              <Select {...p} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as TenantRole })}>
                {TENANT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
            )}
          </Field>
          {form.role !== 'ADMIN' && <StorePicker value={form.storeIds} onChange={(v) => setForm({ ...form, storeIds: v })} />}
          <p className="text-xs text-slate-500">
            Vendedor: cria cobranças e vê as vendas do dia nas lojas autorizadas. Contador: somente leitura e exportação. Administrador: acesso total à empresa.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={saving}>Enviar convite</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={`Editar ${edit?.name ?? ''}`}>
        {edit && (
          <EditForm member={edit} saving={saving} onSave={(patch) => save(patch, edit.userId)} StorePicker={StorePicker} />
        )}
      </Dialog>
    </>
  );
}

function EditForm({
  member,
  saving,
  onSave,
  StorePicker,
}: {
  member: Member;
  saving: boolean;
  onSave: (p: { role: TenantRole; storeIds: string[] }) => void;
  StorePicker: (p: { value: string[]; onChange: (v: string[]) => void }) => React.ReactNode;
}) {
  const [role, setRole] = useState<TenantRole>(member.role);
  const [storeIds, setStoreIds] = useState<string[]>(member.storeIds === 'ALL' ? [] : member.storeIds);
  return (
    <div className="flex flex-col gap-3">
      <Field label="Papel">
        {(p) => (
          <Select {...p} value={role} onChange={(e) => setRole(e.target.value as TenantRole)}>
            {TENANT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        )}
      </Field>
      {role !== 'ADMIN' && <StorePicker value={storeIds} onChange={setStoreIds} />}
      <div className="flex justify-end">
        <Button loading={saving} onClick={() => onSave({ role, storeIds })}>Salvar</Button>
      </div>
    </div>
  );
}
