# Frontend de Banco Demo

MVP en React, TypeScript y Vite conectado al API Gateway del proyecto bancario.

## Ejecutar en desarrollo

Arranca `account-service` en el puerto 8100, `transaction-service` en el 8101 con su perfil local y `apigateway` en el 8080. Después:

```powershell
cd 'D:\Demos spring boot\frontend'
npm install
npm run dev
```

Abre la dirección que muestra Vite, normalmente `http://localhost:5173`. El proxy de Vite envía `/auth` y `/v1` al Gateway en `http://localhost:8080`. Para otro puerto, copia `.env.example` a `.env` y cambia `GATEWAY_URL`; reinicia Vite después.

## Flujo del MVP

- Login: `POST /auth/login`. El JWT se guarda en `sessionStorage` durante la sesión de la pestaña y se envía como `Authorization: Bearer <token>` en cada solicitud protegida. Al vencer el token o recibir 401, vuelve al login.
- Cuentas: `GET /v1/accounts/me` carga las cuentas del usuario. `GET /v1/accounts/{id}` actualiza el saldo seleccionado.
- Retiro: `POST /v1/transactions/debit`, con cuenta propia, monto, divisa de la cuenta y `Idempotency-Key`.
- Transferencia: `POST /v1/transactions/transfers`, con cuenta origen propia y número de cuenta destino de 10 a 14 dígitos.
- Depósito: `POST /v1/transactions/credit`, visible solo para `OPERATOR`. La API recibe el ID de la cuenta destino y su divisa.

Después de una operación exitosa, la interfaz vuelve a consultar las cuentas. Ante un fallo de red, conserva la misma clave de idempotencia para reintentar sin cambiar los datos. Las reglas de autorización permanecen en el Gateway y en los microservicios; el frontend solo adapta la interfaz al rol.

## Configuración de publicación

`npm run build` genera `dist`. Sirve el frontend y las rutas `/auth` y `/v1` bajo el mismo origen mediante un proxy hacia el Gateway. También puedes configurar `VITE_API_BASE_URL`, pero si apunta a otro origen el Gateway necesitará una configuración CORS adecuada. La variable `VITE_API_BASE_URL` se inserta en la compilación; `GATEWAY_URL` solo la usa el servidor de desarrollo.

La clave interna entre microservicios y la clave privada JWT no se envían al navegador.
