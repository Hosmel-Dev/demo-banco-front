import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError, deposit, getAccount, getMyAccounts, jwtExpiresAt, login, transfer, withdraw,
  type Account, type AccountReceipt, type Currency, type Session, type TransferReceipt,
} from './api'

type Operation = 'withdrawal' | 'transfer' | 'deposit'
type Receipt = { kind: Operation; data: AccountReceipt | TransferReceipt }
type Busy = 'login' | 'account' | 'operation' | null

const SESSION_KEY = 'bank-demo-session'

function restoreSession(): Session | null {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Session>
      if (typeof parsed.token === 'string' && typeof parsed.username === 'string' &&
          (parsed.role === 'CUSTOMER' || parsed.role === 'OPERATOR') &&
          (jwtExpiresAt(parsed.token) ?? 0) > Date.now()) {
        return parsed as Session
      }
    }
  } catch {
    // Una sesión dañada o vencida se descarta.
  }
  sessionStorage.removeItem(SESSION_KEY)
  return null
}

function money(amount: number, currency: Currency): string {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(amount)
}

function dateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date)
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'
}

function parseAmount(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  const amount = Number(normalized)
  return /^\d+(\.\d{1,2})?$/.test(normalized) && amount >= 0.01 && amount <= 100000
    ? amount : null
}

function ArrowIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function WalletIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.6" /><path d="M16 12h5M6 6V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="16" cy="13" r="1" fill="currentColor" /></svg>
}

function App() {
  const [session, setSession] = useState<Session | null>(restoreSession)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [account, setAccount] = useState<Account | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [activeOperation, setActiveOperation] = useState<Operation>(
    () => session?.role === 'OPERATOR' ? 'deposit' : 'withdrawal',
  )
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [destinationNumber, setDestinationNumber] = useState('')
  const [depositAccountId, setDepositAccountId] = useState('')
  const [depositCurrency, setDepositCurrency] = useState<Currency>('PEN')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [loginError, setLoginError] = useState('')
  const [accountError, setAccountError] = useState('')
  const [operationError, setOperationError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const pendingOperation = useRef<{ signature: string; key: string } | null>(null)

  function signOut(message = '') {
    sessionStorage.removeItem(SESSION_KEY)
    setSession(null)
    setAccounts([])
    setAccount(null)
    setReceipt(null)
    setPassword('')
    setBusy(null)
    setLoginError(message)
    pendingOperation.current = null
  }

  function handleAuthError(error: unknown): boolean {
    if (error instanceof ApiError && error.status === 401) {
      signOut('Tu sesión venció. Inicia sesión nuevamente.')
      return true
    }
    return false
  }

  useEffect(() => {
    if (!session) return
    const expiresAt = jwtExpiresAt(session.token)
    if (!expiresAt || expiresAt <= Date.now()) {
      signOut('Tu sesión venció. Inicia sesión nuevamente.')
      return
    }
    const timer = window.setTimeout(
      () => signOut('Tu sesión venció. Inicia sesión nuevamente.'),
      Math.min(expiresAt - Date.now(), 2147483647),
    )
    return () => window.clearTimeout(timer)
  }, [session])

  useEffect(() => {
    if (!session) return
    let active = true
    setBusy('account')
    setAccountError('')
    getMyAccounts(session.token)
      .then(result => {
        if (!active) return
        setAccounts(result)
        setAccount(current => result.find(item => item.id === current?.id) ?? result[0] ?? null)
      })
      .catch(error => {
        if (!active) return
        if (!handleAuthError(error)) setAccountError(readableError(error))
      })
      .finally(() => { if (active) setBusy(null) })
    return () => { active = false }
  }, [session, reloadKey])

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginError('')
    setBusy('login')
    try {
      const nextSession = await login(username.trim(), password)
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession))
      setActiveOperation(nextSession.role === 'OPERATOR' ? 'deposit' : 'withdrawal')
      setSession(nextSession)
      setPassword('')
    } catch (error) {
      setLoginError(error instanceof ApiError && error.status === 401
        ? 'Usuario o contraseña incorrectos.' : readableError(error))
    } finally {
      setBusy(null)
    }
  }

  function selectAccount(id: number) {
    setAccount(accounts.find(item => item.id === id) ?? null)
    setAccountError('')
    setRefreshError('')
    setOperationError('')
    setReceipt(null)
    pendingOperation.current = null
  }

  async function refreshBalance() {
    if (!session || !account) return
    setRefreshError('')
    setBusy('account')
    try {
      const updated = await getAccount(account.id, session.token)
      setAccount(updated)
      setAccounts(current => current.map(item => item.id === updated.id ? updated : item))
    } catch (error) {
      if (!handleAuthError(error)) setRefreshError(readableError(error))
    } finally {
      setBusy(null)
    }
  }

  function chooseOperation(operation: Operation) {
    setActiveOperation(operation)
    setAmount('')
    setDescription('')
    setOperationError('')
    setRefreshError('')
    setReceipt(null)
    pendingOperation.current = null
    if (operation === 'deposit' && account && !depositAccountId) {
      setDepositAccountId(String(account.id))
      setDepositCurrency(account.balance.currency)
    }
  }

  async function submitOperation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || busy !== null) return
    setOperationError('')
    setRefreshError('')
    setReceipt(null)

    const requestedAmount = parseAmount(amount)
    if (requestedAmount === null) {
      setOperationError('Ingresa un monto entre 0.01 y 100 000.00, con hasta dos decimales.')
      return
    }

    let targetId: number | null = null
    if (activeOperation === 'deposit') {
      if (session.role !== 'OPERATOR') {
        setOperationError('Solo un operador puede registrar depósitos.')
        return
      }
      targetId = Number(depositAccountId.trim())
      if (!/^\d+$/.test(depositAccountId.trim()) || !Number.isSafeInteger(targetId) || targetId <= 0) {
        setOperationError('Ingresa un ID de cuenta válido.')
        return
      }
    } else {
      if (!account) return
      if (account.status !== 'ACTIVE') {
        setOperationError('La cuenta de origen debe estar activa.')
        return
      }
      if (activeOperation === 'transfer' && !/^\d{10,14}$/.test(destinationNumber.trim())) {
        setOperationError('El número de cuenta destino debe tener entre 10 y 14 dígitos.')
        return
      }
    }

    const currency = activeOperation === 'deposit' ? depositCurrency : account!.balance.currency
    const signature = [activeOperation, activeOperation === 'deposit' ? targetId : account!.id,
      activeOperation === 'transfer' ? destinationNumber.trim() : '',
      requestedAmount.toFixed(2), currency, description.trim()].join('|')
    if (pendingOperation.current?.signature !== signature) {
      pendingOperation.current = { signature, key: crypto.randomUUID() }
    }

    setBusy('operation')
    try {
      const key = pendingOperation.current.key
      const result = activeOperation === 'withdrawal'
        ? await withdraw(account!, requestedAmount, description, key, session.token)
        : activeOperation === 'transfer'
          ? await transfer(account!, destinationNumber, requestedAmount, description, key, session.token)
          : await deposit(targetId!, requestedAmount, depositCurrency, description, key, session.token)

      setReceipt({ kind: activeOperation, data: result })
      pendingOperation.current = null
      setAmount('')
      setDescription('')
      if (activeOperation === 'transfer') setDestinationNumber('')

      try {
        const refreshed = await getMyAccounts(session.token)
        setAccounts(refreshed)
        setAccount(current => refreshed.find(item => item.id === current?.id) ?? refreshed[0] ?? null)
      } catch (error) {
        if (!handleAuthError(error)) {
          setRefreshError(`La operación respondió ${result.status}, pero no se pudo actualizar el saldo: ${readableError(error)}`)
        }
      }
    } catch (error) {
      if (!handleAuthError(error)) {
        setOperationError(error instanceof ApiError && error.status === 0
          ? 'No se pudo confirmar la operación. Revisa el saldo antes de reintentar; se conservará la misma clave si no cambias los datos.'
          : readableError(error))
      }
    } finally {
      setBusy(null)
    }
  }

  const operationTitle = activeOperation === 'withdrawal' ? 'Retirar dinero'
    : activeOperation === 'transfer' ? 'Transferir dinero' : 'Registrar depósito'
  const operationCurrency = activeOperation === 'deposit' ? depositCurrency : account?.balance.currency ?? 'PEN'

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand"><span className="brand-symbol">B<span>.</span></span><span>Banco <strong>Demo</strong></span></div>
        {session && <div className="header-actions"><span className="user-pill"><span className="user-dot" />{session.username}<span className="role-label">{session.role === 'OPERATOR' ? 'Operador' : 'Cliente'}</span></span><button className="text-button" type="button" onClick={() => signOut()}>Cerrar sesión</button></div>}
      </header>

      {!session ? (
        <main className="login-layout">
          <section className="intro-panel">
            <div className="eyebrow"><span className="eyebrow-line" /> TU BANCA, MÁS CLARA</div>
            <h1>Tu dinero,<br /><em>en buenas manos.</em></h1>
            <p>Consulta tus cuentas y realiza retiros o transferencias desde un solo lugar. Los operadores también pueden registrar depósitos.</p>
            <div className="intro-detail"><span className="detail-icon"><WalletIcon /></span><span>Accede con tu usuario de prueba para comenzar.</span></div>
            <div className="intro-decoration" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><div className="center-glow" /></div>
          </section>
          <section className="login-panel">
            <div className="login-card">
              <div className="small-label">ACCESO A TU CUENTA</div>
              <h2>Bienvenido de nuevo</h2>
              <p className="muted">Ingresa tus credenciales para continuar.</p>
              <form onSubmit={submitLogin}>
                <label htmlFor="username">Usuario</label>
                <input id="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required placeholder="Tu nombre de usuario" />
                <label htmlFor="password">Contraseña</label>
                <input id="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required placeholder="Tu contraseña" />
                {loginError && <p className="alert error" role="alert">{loginError}</p>}
                <button className="primary-button login-button" disabled={busy === 'login'} type="submit">{busy === 'login' ? 'Ingresando…' : 'Ingresar a mi cuenta'}<ArrowIcon /></button>
              </form>
              <p className="card-footnote">Proyecto de aprendizaje · Entorno de demostración</p>
            </div>
          </section>
        </main>
      ) : (
        <main className="dashboard">
          <div className="dashboard-heading"><div><div className="small-label">PANEL PERSONAL</div><h1>Hola, {session.username}<span className="heading-dot">.</span></h1><p>Consulta tu saldo y administra tus operaciones.</p></div><div className="demo-badge"><span /> Entorno de prueba</div></div>

          <div className="dashboard-grid">
            <div className="account-column">
            <section className="card lookup-card">
              <div className="section-title"><span className="section-icon"><WalletIcon /></span><div><h2>Mis cuentas</h2><p>Vinculadas a tu usuario.</p></div></div>
              {busy === 'account' && !account && <div className="account-loading" role="status">Cargando tus cuentas…</div>}
              {accountError && <div><p className="alert error" role="alert">{accountError}</p><button className="secondary-button" disabled={busy !== null} type="button" onClick={() => setReloadKey(value => value + 1)}>Reintentar</button></div>}
              {!account && !accountError && busy !== 'account' && <p className="account-empty">No hay cuentas vinculadas a este usuario.</p>}
              {accounts.length > 1 && account && <div className="account-choice"><label htmlFor="account-select">Selecciona una de tus cuentas</label><select id="account-select" value={account.id} onChange={event => selectAccount(Number(event.target.value))}>{accounts.map(item => <option key={item.id} value={item.id}>{item.accountNumber} · {item.balance.currency}</option>)}</select></div>}
              {account && <div className="account-summary"><div className="account-topline"><span>{account.accountType}</span><span className={`status ${account.status === 'ACTIVE' ? 'active' : ''}`}>{account.status === 'ACTIVE' ? 'Activa' : account.status}</span></div><div className="balance-label">Saldo disponible</div><div className="balance">{money(account.balance.amount, account.balance.currency)}</div><div className="account-footer"><span>Cuenta Nº {account.accountNumber}</span><button className="refresh-button" type="button" onClick={refreshBalance} disabled={busy !== null}>Actualizar saldo</button></div></div>}
              {refreshError && <p className="alert error" role="alert">{refreshError}</p>}
            </section>
            {receipt && <section className="receipt card" aria-live="polite"><div className="receipt-check">✓</div><div><div className="small-label">RESULTADO DE LA OPERACIÓN</div><h2>{receipt.kind === 'transfer' ? 'Transferencia' : receipt.kind === 'deposit' ? 'Depósito' : 'Retiro'} · {receipt.data.status}</h2><p>{money(receipt.data.amount, receipt.data.currency)} · Transacción Nº {receipt.data.transactionId} · {dateTime(receipt.data.createdAt)}</p>{'fromAccountId' in receipt.data && <p>Cuenta origen ID {receipt.data.fromAccountId} → destino ID {receipt.data.toAccountId}</p>}<p className="receipt-key">Clave de solicitud: {receipt.data.idempotencyKey}</p></div></section>}
            </div>

            <section className="card operation-card">
              <div className="section-title"><span className="section-icon withdrawal-icon"><ArrowIcon /></span><div><h2>Operaciones</h2><p>Gestiona movimientos desde el Gateway.</p></div></div>
              <div className="operation-tabs" role="tablist" aria-label="Tipo de operación">
                <button type="button" role="tab" aria-selected={activeOperation === 'withdrawal'} className={activeOperation === 'withdrawal' ? 'selected' : ''} onClick={() => chooseOperation('withdrawal')} disabled={busy !== null}>Retiro</button>
                <button type="button" role="tab" aria-selected={activeOperation === 'transfer'} className={activeOperation === 'transfer' ? 'selected' : ''} onClick={() => chooseOperation('transfer')} disabled={busy !== null}>Transferencia</button>
                {session.role === 'OPERATOR' && <button type="button" role="tab" aria-selected={activeOperation === 'deposit'} className={activeOperation === 'deposit' ? 'selected' : ''} onClick={() => chooseOperation('deposit')} disabled={busy !== null}>Depósito</button>}
              </div>

              {activeOperation !== 'deposit' && !account ? (
                <div className="empty-state"><div className="empty-symbol">↗</div><h3>Selecciona una cuenta propia</h3><p>Cuando cargue una cuenta vinculada a tu usuario, podrás operar desde ella.</p></div>
              ) : (
                <form onSubmit={submitOperation}>
                  <h3 className="operation-heading">{operationTitle}</h3>
                  {activeOperation !== 'deposit' && account && <div className="selected-account">Desde <strong>Cuenta Nº {account.accountNumber}</strong><span>{account.balance.currency}</span></div>}
                  {activeOperation === 'transfer' && <><label htmlFor="destination-number">Número de cuenta destino</label><input id="destination-number" inputMode="numeric" value={destinationNumber} onChange={event => setDestinationNumber(event.target.value)} minLength={10} maxLength={14} pattern="[0-9]{10,14}" placeholder="10 a 14 dígitos" required /></>}
                  {activeOperation === 'deposit' && <><div className="deposit-fields"><div><label htmlFor="deposit-account-id">ID de la cuenta destino</label><input id="deposit-account-id" inputMode="numeric" value={depositAccountId} onChange={event => setDepositAccountId(event.target.value)} placeholder="ID de cuenta" required /></div><div><label htmlFor="deposit-currency">Divisa</label><select id="deposit-currency" value={depositCurrency} onChange={event => setDepositCurrency(event.target.value as Currency)}><option value="PEN">Soles (PEN)</option><option value="USD">Dólares (USD)</option></select></div></div><p className="field-hint deposit-hint">El depósito usa el ID de cuenta que requiere la API. Solo operadores pueden registrarlo.</p></>}
                  <label htmlFor="operation-amount">Monto</label>
                  <div className="amount-field"><span>{operationCurrency === 'PEN' ? 'S/' : 'US$'}</span><input id="operation-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" required /></div>
                  <label htmlFor="operation-description">Descripción <span className="optional">(opcional)</span></label>
                  <input id="operation-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={200} placeholder="Motivo de la operación" />
                  {operationError && <p className="alert error" role="alert">{operationError}</p>}
                  <button className="primary-button" type="submit" disabled={busy !== null || (activeOperation !== 'deposit' && account?.status !== 'ACTIVE')}>{busy === 'operation' ? 'Procesando…' : `Confirmar ${activeOperation === 'transfer' ? 'transferencia' : activeOperation === 'deposit' ? 'depósito' : 'retiro'}`}<ArrowIcon /></button>
                  <p className="field-hint">La solicitud incluye un JWT y una clave de operación única para reintentos.</p>
                </form>
              )}
            </section>
          </div>

        </main>
      )}

      <footer className="site-footer"><span>Banco Demo</span><span>Proyecto académico · 2026</span></footer>
    </div>
  )
}

export default App
