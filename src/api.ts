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

interface ReceiptBase {
  transactionId: number
  idempotencyKey: string
  type: string
  amount: number
  currency: Currency
  status: string
  createdAt: string
}

export interface AccountReceipt extends ReceiptBase {
  accountId: number
}

export interface TransferReceipt extends ReceiptBase {
  fromAccountId: number
  toAccountId: number
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
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el Gateway. Comprueba que los servicios estén activos.')
  }

  const body = (await response.json().catch(() => null)) as (ApiProblem & T) | null
  if (!response.ok) {
    const fallback = response.status === 401
      ? 'La sesión no es válida o ha vencido.'
      : response.status === 403
        ? 'No tienes permiso para realizar esta operación.'
        : response.status === 404
          ? 'No se encontró el recurso solicitado.'
          : `La solicitud falló (HTTP ${response.status}).`
    throw new ApiError(response.status, body?.detail || body?.message || body?.title || fallback)
  }
  if (body === null) throw new ApiError(response.status, 'El servidor respondió sin datos.')
  return body
}

export function jwtExpiresAt(token: string): number | null {
  try {
    const segment = token.split('.')[1]
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { exp?: unknown }
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null
  } catch {
    return null
  }
}

export async function login(username: string, password: string): Promise<Session> {
  const session = await request<Session>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  if (!session.token || !session.username ||
      (session.role !== 'CUSTOMER' && session.role !== 'OPERATOR')) {
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

function postOperation<T>(path: string, body: object, idempotencyKey: string, token: string): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  }, token)
}

export function withdraw(account: Account, amount: number, description: string,
  idempotencyKey: string, token: string): Promise<AccountReceipt> {
  return postOperation('/v1/transactions/debit', {
    accountId: account.id,
    amount,
    currency: account.balance.currency,
    description: description.trim() || null,
  }, idempotencyKey, token)
}

export function transfer(account: Account, destinationAccountNumber: string, amount: number,
  description: string, idempotencyKey: string, token: string): Promise<TransferReceipt> {
  return postOperation('/v1/transactions/transfers', {
    originAccountId: account.id,
    destinationAccountNumber: destinationAccountNumber.trim(),
    amount,
    currency: account.balance.currency,
    description: description.trim() || null,
  }, idempotencyKey, token)
}

export function deposit(accountId: number, amount: number, currency: Currency, description: string,
  idempotencyKey: string, token: string): Promise<AccountReceipt> {
  return postOperation('/v1/transactions/credit', {
    accountId,
    amount,
    currency,
    description: description.trim() || null,
  }, idempotencyKey, token)
}
