# Revisión de seguridad (21/10/2026)

Revisión de todo lo que está en internet: las 58 rutas de `app/api`, las sesiones, los secretos, el Worker, el service worker,
las dependencias y el historial de git. Lo que se pudo arreglar en el código se arregló y tiene pruebas
(`tests/seguridad.test.ts`, `tests/ai-brains.test.ts`). Lo que depende de la cuenta de Cloudflare está al final, como pendiente.

## Lo que ya estaba bien

- Contraseñas con PBKDF2 (100.000 iteraciones, el tope de Workers) y sal propia. Nunca en claro.
- Cookie de sesión `HttpOnly; Secure; SameSite=Lax`: otro sitio no puede usar tu sesión ni leerla.
- Todas las rutas con datos de una persona piden sesión, y cada escritura filtra por `user_id` (nadie toca lo de otro).
- Los secretos del administrador (Telegram, IA) se guardan cifrados (AES-GCM) y solo los cambia el administrador; nunca vuelven
  al navegador. El código para reclamar el administrador ya se usó y se borró.
- Las claves de Binance se guardan cifradas, se exigen de solo lectura y solo vuelven a su dueño con sesión, sin caché.
- El webhook de Telegram exige el secreto que manda Telegram; los códigos para vincular son de 12 bytes al azar.
- Consultas a D1 siempre con parámetros: no hay inyección SQL. No hay `innerHTML` ni `dangerouslySetInnerHTML`.
- Sin secretos en el repo ni en el historial. Dependencias de producción (React y Drizzle): 0 vulnerabilidades.
- El service worker no guarda nada de `/api/`.

## Lo que se arregló

| Riesgo | Arreglo |
|---|---|
| Probar contraseñas sin límite | Máximo 8 fallas por email y 30 por IP cada 15 minutos (429 con cuánto esperar). Un acierto limpia el email. `lib/auth-limites.ts` |
| Adivinar qué emails tienen cuenta midiendo el tiempo | Sin cuenta se hace el mismo cálculo que con cuenta (`fakeVerify`). |
| Crear cuentas en masa (y gastar IA con cada una) | Máximo 5 cuentas nuevas por IP y por hora. |
| Gastar la IA paga con muchas cuentas | Tope diario de Claude entre todos (`CLAUDE_GLOBAL_DAILY`, 150); pasado el tope contestan los cerebros gratis. |
| Sesiones legibles si alguien lee la base | Se guarda el hash del token, no el token. Las sesiones viejas se pasan a hash la primera vez que se usan. |
| Velas inventadas que después veían otros (`/api/klines`) | La serie tiene que ser coherente (precios, horario, sin huecos) y su último cierre coincidir con Kraken o Coinbase. `lib/aporte-velas.ts`, `lib/corroborar.ts` |
| Libros de órdenes inventados y pares inventados llenando la base (`/api/liquidity-history`) | Solo se guarda si el precio coincide con Kraken o Coinbase. |
| Ensuciar la memoria del cerebro (`/api/brain`) | Con velas del navegador se guarda solo si el último cierre y cada resultado coinciden con Kraken o Coinbase; si no, responde sin guardar. |
| Gastar las lecturas de D1 sin sesión | El historial de liquidez (hasta 1.440 filas por pedido) y la tendencia de dominancia (hasta 500) se leen una vez por minuto para todos, en pocas ventanas. La sincronización pública de señales corre como mucho una vez por minuto. |
| Llenar la memoria del Worker con claves distintas | La caché del Worker tiene tope (600 claves; se van las más viejas). |
| Que el servidor le escriba a una dirección cualquiera (notificaciones) | Solo servicios de notificaciones de los navegadores, por HTTPS y con tope de largo. |
| Meter la app en un marco de otro sitio (clickjacking) y otros | Cabeceras en todas las respuestas: `X-Frame-Options`, `frame-ancestors 'self'`, `nosniff`, `Referrer-Policy`, HSTS y `Permissions-Policy` (sin cámara, ubicación ni pagos; micrófono solo la propia página). `lib/seguridad-cabeceras.ts` |
| Llamar a la API en bucle desde una IP | Límite en el propio Worker: 300 pedidos por minuto por IP a `/api/` y 20 para entrar o crear cuenta (429 con cuánto esperar). El webhook de Telegram no se limita. `lib/limite-pedidos.ts` |
| Activar la clave de cifrado fuerte rompía las claves de Binance ya guardadas | Ahora se pueden leer con la clave anterior: se puede activar `ENCRYPTION_KEY` sin que nadie tenga que volver a vincular. |

## Pendiente (lo hace la persona, en Cloudflare)

1. **Rotar los tokens que quedaron a la vista** y borrar el token «Altradar 2» (ya estaba anotado en `docs/araña/objetivos.md`).
2. **Clave de cifrado fuerte**: hoy los secretos se cifran con una clave guardada en la misma base. En la app, CONFIGURACIÓN →
   «GENERAR UNA CLAVE DE CIFRADO FUERTE» la arma en tu navegador (no viaja a ningún lado) y dice dónde pegarla en Cloudflare
   (Workers y Pages → alt-radar-pro → Variables y secretos → Secreto `ENCRYPTION_KEY`). Lo ya guardado se vuelve a cifrar con la
   clave fuerte solo, la primera vez que se lee (secretos del administrador y claves de Binance).
3. **Si pasás a un dominio propio**: ahí sí existe la regla de límite de pedidos del WAF de Cloudflare (Seguridad → WAF → Rate
   limiting; el plan gratis trae una), que frena el abuso antes de llegar al Worker. En `*.workers.dev` no existe: por eso el
   límite va en el Worker (arriba).
4. **Herramientas de desarrollo**: `npm audit` marca 30 avisos en paquetes que solo se usan para compilar y probar (wrangler,
   miniflare, ws), no en lo que corre en internet. Se actualizan cuando el plugin de Cloudflare para Vite lo permita.

## Lo que queda abierto, dicho

- Los aportes de velas de un par que no está ni en Kraken ni en Coinbase se aceptan si son coherentes: no hay contra qué
  compararlos.
- La app no tiene política de scripts (CSP `script-src`): una mal ajustada rompe la app. No hay ningún lugar que inserte HTML.
- La regla de crear cuenta dice si un email ya existe (para que la persona sepa qué pasó). Con el límite por IP no se puede
  usar para listar emails en masa.
- Si querés meter la app dentro de otra página tuya (un iframe), hay que agregar ese dominio a `frame-ancestors`.
- El límite por email tiene su contracara: alguien que falle 8 veces a propósito con tu email te traba el login 15 minutos. Es
  el precio de que nadie pueda probar contraseñas sin parar; el límite por IP no tiene ese problema.
