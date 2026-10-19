'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Permission, TenantRole } from '@adapterpay/shared';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; email: string; name: string; isSuperadmin: boolean; mfaEnabled: boolean; mfaVerified: boolean };
  role: TenantRole | null;
  isOwner: boolean;
  permissions: Permission[];
  storeIds: 'ALL' | string[];
  tenant: null | {
    id: string;
    tradeName: string;
    status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED';
    timezone: string;
    logoUrl: string | null;
    brandColor: string | null;
    subscription: null | {
      status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
      planId: string;
      planName: string;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
    };
    onboarding: { mpConnected: boolean; hasStore: boolean; hasPos: boolean };
  };
  memberships: Array<{ tenantId: string; tradeName: string; role: TenantRole; tenantStatus: string }>;
}

interface SessionCtx {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children, requireSuperadmin = false }: { children: ReactNode; requireSuperadmin?: boolean }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api<Me>('/auth/me');
      setMe(data);
      if (data.user.isSuperadmin && !data.user.mfaEnabled) {
        router.replace('/seguranca/mfa?obrigatorio=1');
      } else if (requireSuperadmin && !data.user.isSuperadmin) {
        router.replace('/app');
      } else if (!requireSuperadmin && data.user.isSuperadmin && !data.tenant) {
        router.replace('/superadmin');
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === 'UNAUTHENTICATED')) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (err instanceof ApiError && err.code === 'MFA_ENROLLMENT_REQUIRED') {
        router.replace('/seguranca/mfa?obrigatorio=1');
        return;
      }
      throw err;
    } finally {
      setLoading(false);
    }
  }, [router, requireSuperadmin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = useCallback((p: Permission) => !!me?.permissions.includes(p), [me]);
  return <Ctx.Provider value={{ me, loading, reload, can }}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession fora do SessionProvider');
  return ctx;
}
