export type Role = 'CUSTOMER' | 'OPERATOR'
export type Currency = 'PEN' | 'USD'

export interface Session {
  username: string
  role: Role
  token: string
}

export interface Account {
  id: number
  accountNumber: string
  accountType: string
  balance: { amount: number; currency: Currency }
  status: string
  ownerUserId: number
}

export interface Withdrawal {
  transactionId: number
  idempotencyKey: string
  type: string
  amount: number
  currency: Currency
  status: string
  accountId: number
  createdAt: string
}

interface ApiProblem {
  detail?: string
  title?: string
  message?: string
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Comprueba que los servicios estén activos.')
  }

  const body = (await response.json().catch(() => null)) as (ApiProblem & T) | null
  if (!response.ok) {
    const fallback = response.status === 403
      ? 'No tienes permiso para acceder a este recurso.'
      : response.status === 404
        ? 'No se encontró el recurso solicitado.'
        : `La solicitud falló (HTTP ${response.status}).`
    throw new ApiError(response.status, body?.detail || body?.message || body?.title || fallback)
  }
  if (!body) throw new ApiError(response.status, 'El servidor respondió sin datos.')
  return body
}

export async function login(username: string, password: string): Promise<Session> {
  const session = await request<Session>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  if (!session.token || !session.username || !session.role) {
    throw new ApiError(0, 'La respuesta de inicio de sesión está incompleta.')
  }
  return session
}

export function getAccount(id: number, token: string): Promise<Account> {
  return request<Account>(`/v1/accounts/${id}`, {}, token)
}

export async function getMyAccounts(token: string): Promise<Account[]> {
  const accounts = await request<unknown>('/v1/accounts/me', {}, token)
  if (!Array.isArray(accounts)) {
    throw new ApiError(0, 'El servicio de cuentas devolvió un formato inesperado.')
  }
  return accounts as Account[]
}

export function withdraw(
  account: Account,
  amount: number,
  description: string,
  idempotencyKey: string,
  token: string,
): Promise<Withdrawal> {
  return request<Withdrawal>('/v1/transactions/debit', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      accountId: account.id,
      amount,
      currency: account.balance.currency,
      description: description.trim() || null,
    }),
  }, token)
}
