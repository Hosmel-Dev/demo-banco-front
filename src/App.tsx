import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, getAccount, getMyAccounts, login, withdraw, type Account, type Session, type Withdrawal } from './api'

const SESSION_KEY = 'bank-demo-session'

function restoreSession(): Session | null {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored) as Partial<Session>
    if (typeof parsed.token === 'string' && typeof parsed.username === 'string' &&
      (parsed.role === 'CUSTOMER' || parsed.role === 'OPERATOR')) {
      return parsed as Session
    }
  } catch {
    // Una sesión dañada se descarta y se solicita iniciar sesión otra vez.
  }
  sessionStorage.removeItem(SESSION_KEY)
  return null
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(amount)
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'
}

function dateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date)
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
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [receipt, setReceipt] = useState<Withdrawal | null>(null)
  const [loginError, setLoginError] = useState('')
  const [accountError, setAccountError] = useState('')
  const [withdrawalError, setWithdrawalError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [busy, setBusy] = useState<'login' | 'account' | 'withdrawal' | null>(null)
  const pendingWithdrawal = useRef<{ signature: string; key: string } | null>(null)

  function signOut(message = '') {
    sessionStorage.removeItem(SESSION_KEY)
    setSession(null)
    setAccount(null)
    setAccounts([])
    setReceipt(null)
    setPassword('')
    setBusy(null)
    setLoginError(message)
    pendingWithdrawal.current = null
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
    let active = true
    setBusy('account')
    setAccountError('')
    getMyAccounts(session.token)
      .then(result => {
        if (!active) return
        setAccounts(result)
        setAccount(result[0] ?? null)
      })
      .catch(error => {
        if (!active) return
        if (!handleAuthError(error)) {
          setAccountError(error instanceof ApiError && error.status === 404
            ? 'Aún no está disponible la consulta de cuentas vinculadas.'
            : readableError(error))
        }
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
      setSession(nextSession)
      setPassword('')
    } catch (error) {
      setLoginError(error instanceof ApiError && error.status === 401
        ? 'Usuario o contraseña incorrectos.' : readableError(error))
    } finally {
      setBusy(null)
    }
  }

  async function loadAccount(id: number, token: string): Promise<Account> {
    const result = await getAccount(id, token)
    setAccount(result)
    setAccounts(current => current.map(item => item.id === result.id ? result : item))
    return result
  }

  function selectAccount(id: number) {
    setAccount(accounts.find(item => item.id === id) ?? null)
    setAccountError('')
    setRefreshError('')
    setReceipt(null)
    setAmount('')
    setDescription('')
    pendingWithdrawal.current = null
  }

  async function refreshBalance() {
    if (!session || !account) return
    setRefreshError('')
    setBusy('account')
    try {
      await loadAccount(account.id, session.token)
    } catch (error) {
      if (!handleAuthError(error)) setRefreshError(readableError(error))
    } finally {
      setBusy(null)
    }
  }

  async function submitWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || !account) return
    setWithdrawalError('')
    setRefreshError('')
    setReceipt(null)

    const normalized = amount.trim().replace(',', '.')
    const requestedAmount = Number(normalized)
    if (!/^\d+(\.\d{1,2})?$/.test(normalized) || requestedAmount < 0.01 || requestedAmount > 100000) {
      setWithdrawalError('Ingresa un monto entre 0.01 y 100 000.00, con hasta dos decimales.')
      return
    }
    if (account.status !== 'ACTIVE') {
      setWithdrawalError('La cuenta debe estar activa para realizar un retiro.')
      return
    }

    const signature = `${account.id}|${requestedAmount.toFixed(2)}|${account.balance.currency}|${description.trim()}`
    if (pendingWithdrawal.current?.signature !== signature) {
      pendingWithdrawal.current = { signature, key: crypto.randomUUID() }
    }

    setBusy('withdrawal')
    try {
      const result = await withdraw(account, requestedAmount, description, pendingWithdrawal.current.key, session.token)
      setReceipt(result)
      pendingWithdrawal.current = null
      setAmount('')
      setDescription('')
      try {
        await loadAccount(account.id, session.token)
      } catch (error) {
        if (!handleAuthError(error)) setRefreshError(`El retiro respondió ${result.status}, pero no se pudo actualizar el saldo: ${readableError(error)}`)
      }
    } catch (error) {
      if (!handleAuthError(error)) {
        setWithdrawalError(error instanceof ApiError && error.status === 0
          ? 'No se pudo confirmar el retiro. Consulta el saldo o el registro antes de intentarlo otra vez. Se conservará la misma clave de solicitud si reintentas sin cambiar los datos.'
          : readableError(error))
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand"><span className="brand-symbol">B<span>.</span></span><span>Banco <strong>Demo</strong></span></div>
        {session && <div className="header-actions"><span className="user-pill"><span className="user-dot" />{session.username}</span><button className="text-button" type="button" onClick={() => signOut()}>Cerrar sesión</button></div>}
      </header>

      {!session ? (
        <main className="login-layout">
          <section className="intro-panel">
            <div className="eyebrow"><span className="eyebrow-line" /> TU BANCA, MÁS CLARA</div>
            <h1>Tu dinero,<br /><em>en buenas manos.</em></h1>
            <p>Consulta tu cuenta y realiza retiros desde un solo lugar. Una experiencia sencilla para explorar tu banca digital.</p>
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
            <section className="card lookup-card">
              <div className="section-title"><span className="section-icon"><WalletIcon /></span><div><h2>Mis cuentas</h2><p>Vinculadas a tu usuario.</p></div></div>
              {busy === 'account' && !account && <div className="account-loading" role="status">Cargando tus cuentas…</div>}
              {accountError && <div><p className="alert error" role="alert">{accountError}</p><button className="secondary-button" disabled={busy !== null} type="button" onClick={() => setReloadKey(value => value + 1)}>Reintentar</button></div>}
              {!account && !accountError && busy !== 'account' && <p className="account-empty">No hay cuentas vinculadas a este usuario.</p>}
              {accounts.length > 1 && account && <div className="account-choice"><label htmlFor="account-select">Selecciona una de tus cuentas</label><select id="account-select" value={account.id} onChange={event => selectAccount(Number(event.target.value))}>{accounts.map(item => <option key={item.id} value={item.id}>{item.accountNumber} · {item.balance.currency}</option>)}</select></div>}
              {account && <div className="account-summary"><div className="account-topline"><span>{account.accountType}</span><span className={`status ${account.status === 'ACTIVE' ? 'active' : ''}`}>{account.status === 'ACTIVE' ? 'Activa' : account.status}</span></div><div className="balance-label">Saldo disponible</div><div className="balance">{money(account.balance.amount, account.balance.currency)}</div><div className="account-footer"><span>Cuenta Nº {account.accountNumber}</span><button className="refresh-button" type="button" onClick={refreshBalance} disabled={busy !== null}>Actualizar saldo</button></div></div>}
              {refreshError && <p className="alert error" role="alert">{refreshError}</p>}
            </section>

            <section className="card operation-card">
              <div className="section-title"><span className="section-icon withdrawal-icon"><ArrowIcon /></span><div><h2>Retirar dinero</h2><p>Registra un retiro desde tu cuenta.</p></div></div>
              {!account ? <div className="empty-state"><div className="empty-symbol">↗</div><h3>Tu cuenta aparecerá aquí</h3><p>Al cargar una cuenta vinculada a tu usuario, podrás realizar un retiro.</p></div> : <form onSubmit={submitWithdrawal}>
                <div className="selected-account">Desde <strong>Cuenta Nº {account.accountNumber}</strong><span>{account.balance.currency}</span></div>
                <label htmlFor="amount">Monto a retirar</label>
                <div className="amount-field"><span>{account.balance.currency === 'PEN' ? 'S/' : 'US$'}</span><input id="amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" required /></div>
                <label htmlFor="description">Descripción <span className="optional">(opcional)</span></label>
                <input id="description" value={description} onChange={event => setDescription(event.target.value)} maxLength={200} placeholder="Motivo del retiro" />
                {withdrawalError && <p className="alert error" role="alert">{withdrawalError}</p>}
                <button className="primary-button" type="submit" disabled={busy !== null || account.status !== 'ACTIVE'}>{busy === 'withdrawal' ? 'Procesando…' : 'Confirmar retiro'}<ArrowIcon /></button>
                <p className="field-hint">El retiro se enviará a la API con una clave de solicitud única.</p>
              </form>}
            </section>
          </div>

          {receipt && <section className="receipt card" aria-live="polite"><div className="receipt-check">✓</div><div><div className="small-label">RESULTADO DE LA OPERACIÓN</div><h2>Retiro {receipt.status === 'SUCCESS' ? 'registrado' : receipt.status.toLowerCase()}</h2><p>{money(receipt.amount, receipt.currency)} · Transacción Nº {receipt.transactionId} · {dateTime(receipt.createdAt)}</p><p className="receipt-key">Clave de solicitud: {receipt.idempotencyKey}</p></div></section>}
        </main>
      )}

      <footer className="site-footer"><span>Banco Demo</span><span>Proyecto académico · 2026</span></footer>
    </div>
  )
}

export default App
