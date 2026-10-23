# Frontend de Banco Demo

Interfaz mínima en React, TypeScript y Vite para iniciar sesión, mostrar las cuentas del usuario y registrar un retiro. El backend permanece en `D:\Demos spring boot\demo banco`.

## Ejecutar en desarrollo

Necesitas Node.js 20.19 o posterior, y los servicios de cuentas y transacciones activos.

```powershell
cd 'D:\Demos spring boot\frontend'
npm install
npm run dev
```

Abre la URL que imprima Vite (habitualmente `http://localhost:5173`). El servidor de Vite envía `/auth` y `/v1/accounts` a `http://localhost:8100`, y `/v1/transactions` a `http://localhost:8101`. Si esos puertos cambian, copia `.env.example` a `.env` y ajusta `ACCOUNT_SERVICE_URL` y `TRANSACTION_SERVICE_URL`.

## Flujo

1. Inicia sesión con un usuario que ya exista en la base de datos. El navegador conserva el JWT solo durante la sesión de la pestaña.
2. La pantalla carga automáticamente las cuentas vinculadas al usuario. Si tiene varias, permite elegir por número de cuenta sin introducir IDs.
3. Ingresa un monto y confirma el retiro. La solicitud incluye un `Idempotency-Key` y usa la divisa de la cuenta. La pantalla consulta el saldo nuevamente tras recibir la respuesta.

## Contrato pendiente en account-service

El backend aún no ofrece una ruta para buscar cuentas a partir del usuario autenticado. El frontend espera:

```http
GET /v1/accounts/me
Authorization: Bearer <JWT>
```

La respuesta debe ser un arreglo JSON de `AccountResponse`, por ejemplo `[{"id":1,"accountNumber":"...","accountType":"SAVINGS","balance":{"amount":100.00,"currency":"PEN"},"status":"ACTIVE","ownerUserId":1}]`. Si no hay cuentas, devuelve `[]`. El backend debe tomar el ID del usuario del `sub` del JWT y consultar por `owner_user_id`; no debe aceptar un ID de usuario enviado por el navegador. Cuando exista esta ruta, la cuenta aparecerá automáticamente después del login.

El retiro depende de que el backend habilite y autorice `POST /v1/transactions/debit`. Si la ruta sigue denegada, se mostrará el error real de la API. Para las pruebas locales, el navegador entra por el proxy de Vite; no se requiere configurar CORS en los servicios.

## Cuando exista el Gateway

Configura `VITE_API_BASE_URL` con la URL del Gateway si el frontend estará en otro origen. Si se publican juntos en el mismo origen, déjala vacía y enruta `/auth`, `/v1/accounts` y `/v1/transactions` desde el Gateway. Esta variable se inserta al compilar, por lo que requiere una nueva compilación cuando cambia.

```powershell
npm run build
```

La carpeta `dist` contiene los archivos listos para servir. La clave privada y las contraseñas no pertenecen al frontend.
