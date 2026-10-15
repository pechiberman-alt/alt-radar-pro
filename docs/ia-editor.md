# Editor por IA (modelo gratis)

Sirve para seguir editando el proyecto desde el celular cuando se acaban los tokens de Claude. Comentás un pedido en un issue de GitHub, un modelo gratis propone el cambio y se abre un **PR para que lo revises**. Nunca mergea solo.

No reemplaza a Claude: un modelo gratis escribe peor y ve menos del proyecto. Sirve para cambios chicos y acotados (un texto, un estilo, una regla simple, un test). Para algo grande, esperá el reinicio del cupo.

## Cómo se usa (desde la app de GitHub)

1. Abrí un issue (o uno que ya tengas) en el repositorio.
2. Comentá empezando con `/ia`. Dos formas:

```
/ia Cambiá el texto del botón "Siguiente" por "Seguir"
```

```
/ia
archivos: app/aprender-lab.tsx, lib/aprender.ts
Cambiá el texto del botón "Siguiente" por "Seguir"
```

3. Si nombrás los archivos, el modelo mira solo esos. Si no, elige hasta 4 de la lista del mapa de la araña.
4. En unos minutos el workflow comenta en el issue con el link al PR, o con el motivo si no pudo.
5. Revisá el PR y mergealo vos si está bien. Si fallaron el lint o las pruebas, el PR se abre como **borrador**.

## Puesta en marcha (una sola vez, desde la web de GitHub)

- Secreto `IA_API_KEY` (Settings → Secrets and variables → Actions → Secrets): la clave de un proveedor gratis compatible con la API de OpenAI (por ejemplo Groq). Nunca se escribe en el repo.
- Variables opcionales (pestaña Variables): `IA_API_URL` (por defecto `https://api.groq.com/openai/v1/chat/completions`) e `IA_MODELO` (por defecto `llama-3.3-70b-versatile`). Los nombres de los modelos gratis cambian: si el workflow responde que el modelo no existe, cambiá `IA_MODELO`.

## Qué protege

- Solo el dueño del repo lo activa (`author_association == OWNER`) y solo en issues, no en PR: el repo es público.
- Solo abre PR. No mergea, no hace deploy.
- Solo edita archivos que ya existen y que se le mostraron al modelo, de `app/`, `lib/`, `tests/` y `docs/`. Nunca `.github/`, `scripts/`, `drizzle/`, dependencias (`package.json`), `wrangler*`, archivos `.env`, claves ni el mapa de la araña.
- Cada cambio es un buscar y reemplazar exacto: el texto a buscar tiene que aparecer una sola vez. Si algo no coincide, se rechaza todo y no se cambia nada.
- Máximo 4 archivos, 6 cambios y 30.000 caracteres de contexto.
- El lint y las pruebas corren sobre el código del modelo **sin el token ni la clave en el entorno**, y el token no queda guardado en el repo hasta que se sube la rama. Si algo falla, el comentario sale sin secretos.

## Límites y riesgos

- **Calidad**: un modelo gratis se equivoca más. El PR es una propuesta, no un trabajo terminado. Las reglas del proyecto (honestidad, español rioplatense, tests de lógica) las ve recortadas.
- **Privacidad**: el código de los archivos elegidos y el pedido viajan al proveedor del modelo. No pongas claves ni datos de usuarios en un pedido.
- **Términos**: revisá las condiciones y los límites de uso del plan gratis de tu proveedor.
- **Los PR que abre un workflow con `GITHUB_TOKEN` no disparan otros workflows**, así que el lint y las pruebas del PR salen del propio script (se ven en la descripción), no del CI general. El deploy a producción corre igual cuando mergeás a `main`.
- **No probado de punta a punta con la API real**: la lógica (qué se puede tocar, validar y aplicar) está cubierta por tests y se ensayó sin red. Falta la primera corrida real con tu clave: hacela con un pedido chico.
- No sirve para tareas que necesiten crear archivos nuevos o mover cosas: eso queda para Claude.
