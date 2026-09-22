import type { LabelKey } from '@attendance/shared';
import { Loader2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';

import { Button, Field } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { T, useLabels } from '../lib/translation';

/**
 * Built inside the component rather than at module scope.
 *
 * The messages come from the registry, and the registry is only resolved once the dictionary
 * has loaded. A schema frozen at import time would keep whatever wording was current then.
 */
function buildSchema(t: (key: LabelKey) => string) {
  return z.object({
    email: z.email(t('login.error.email')),
    password: z.string().min(1, t('login.error.password')),
    totp: z
      .string()
      .regex(/^\d{6}$/, t('login.error.totp'))
      .optional(),
  });
}

export function LoginPage(): ReactNode {
  const { session, loading, signIn } = useAuth();
  const { t } = useLabels();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; totp?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100">
        <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
      </div>
    );
  }

  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    // Validated with the same library the server uses so the two cannot drift
    // apart about what counts as acceptable input.
    const result = buildSchema(t).safeParse({
      email,
      password,
      totp: totp.length > 0 ? totp : undefined,
    });

    if (!result.success) {
      const fields = z.flattenError(result.error).fieldErrors;
      setErrors({
        email: fields.email?.[0],
        password: fields.password?.[0],
        totp: fields.totp?.[0],
      });
      return;
    }

    setErrors({});
    setPending(true);
    try {
      await signIn(result.data);
      navigate('/', { replace: true });
    } catch (error) {
      // The server answers with one generic message for bad credentials so the
      // response cannot be used to discover which addresses have accounts.
      setFormError(error instanceof ApiError ? error.message : t('login.error.unreachable'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-800">
            <T k="app.brand" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            <T k="login.organisation" />
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          {formError !== null && (
            <p
              role="alert"
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {formError}
            </p>
          )}

          {/*
            `Field` takes `label` as a node, so these carry their badge. `placeholder` and
            `hint` are strings by definition and go through `t()` instead — a number inside a
            placeholder would be read out as part of the hint.
          */}
          <Field
            label={<T k="login.email" />}
            type="email"
            name="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors.email}
            placeholder={t('login.email.placeholder')}
          />

          <Field
            label={<T k="login.password" />}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
          />

          <Field
            label={<T k="login.totp" />}
            type="text"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={totp}
            onChange={(event) => setTotp(event.target.value.replace(/\D/g, ''))}
            error={errors.totp}
            hint={t('login.totp.hint')}
            // Not a label: a digit mask is the same in every language.
            placeholder="000000"
          />

          <Button type="submit" disabled={pending} className="w-full">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <T k={pending ? 'login.submit.pending' : 'login.submit'} />
          </Button>
        </form>
      </div>
    </div>
  );
}
