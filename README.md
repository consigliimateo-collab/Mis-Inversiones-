# Mis inversiones

Terminal de seguimiento de carteras propias y de terceros: mercado con gráficos, cartera con costo promedio,
riesgo (volatilidad, caídas, correlación, concentración) y auditoría de cada dato. App instalable (PWA), sin
dependencias ni compilación.

## Qué protege esta versión

| Riesgo | Mitigación |
|---|---|
| Dato de mercado erróneo | Cada activo se consulta en 2 fuentes (Yahoo Finance y Stooq) y se comparan los últimos 5 cierres completos: coinciden (<1%) = "2 fuentes"; si no = "Discrepan". Precio fuera del rango de 52 semanas, salto diario >40% o dos activos con el mismo precio = "Sospechoso" |
| Dato viejo presentado como actual | Cada dato guarda su fecha y fuente. Si no se puede actualizar, se marca "Desactualizado" (nunca se rellena ni se inventa). Los fines de semana no cuentan como atraso |
| Valuación engañosa | La cartera avisa qué posiciones usan datos no confiables; el panel de alertas y la barra de estado cuentan cuántos activos son verificados, con reservas o no confiables |
| Errores de cálculo | Costo promedio con comisiones, ganancia realizada, pesos, volatilidad, drawdown, beta, correlación, Herfindahl y tamaño de posición están cubiertos por pruebas con valores calculados a mano (`npm test`) |
| Operaciones inconsistentes | No se aceptan cantidades/precios inválidos, fechas futuras ni ventas mayores a la tenencia; no se puede borrar una compra de la que dependen ventas posteriores |
| Pérdida de datos | Respaldo JSON con validación estricta e importación con confirmación; aviso si pasan 7 días sin respaldo o si el navegador no puede guardar; exportación CSV |
| Privacidad de terceros | Las carteras viven solo en el dispositivo; el repositorio solo contiene datos de mercado |
| Inyección | Todo texto del usuario se escapa; los CSV neutralizan fórmulas |
| Histórico corrupto | Las series inválidas (negativas, desordenadas, incompletas) se descartan; los saltos >35% se advierten (posible split) |

## Estructura

```
index.html, css/styles.css   interfaz
js/data.js         catálogo, señales, macro y noticias (estáticos, de la planilla)
js/prices.js       lectura de datos, calidad, frescura y controles de coherencia
js/analytics.js    volatilidad, drawdown, beta, correlación, cartera hipotética
js/portfolio.js    costo promedio, realizado, valuación, concentración, tamaño de posición
js/store.js        estado por dispositivo, migración y respaldos
js/chart.js        gráficos SVG      js/views.js  vistas puras      js/main.js  eventos
scripts/update-prices.mjs   descarga y verifica cotizaciones (GitHub Actions)
data/prices.json, data/history.json   los reescribe el proceso automático
tests/             40 pruebas (fórmulas, fuentes, almacenamiento y app completa)
```

## Puesta en marcha (gratis)

1. Repositorio **público** nuevo en github.com y subir todo el contenido (incluida la carpeta oculta `.github`).
2. Settings, Pages: "Deploy from a branch", rama `main`, carpeta raíz.
3. Settings, Actions, General, Workflow permissions: "Read and write".
4. Actions, "Actualizar precios", Run workflow (la primera vez carga también el histórico).
5. Revisar la pestaña Datos: debe mostrar "2 fuentes" y los controles en verde. Compartir el enlace; cada persona puede instalar la app.

Local: `npm start` (requiere servidor, no abre con doble clic), `npm test`, `npm run update`.

## Límites que conviene conocer

- Las cotizaciones vienen de fuentes públicas no oficiales, con demora de hasta unos 15 minutos; no sirven para operar a alta frecuencia. Antes de operar, confirmar el precio con tu broker.
- P/E, señales, macro y noticias son los de la planilla original (estáticos). Sin cálculo de dividendos ni impuestos.
- Ganancia realizada por costo promedio ponderado; los resultados fiscales pueden diferir.
- La retrospectiva de riesgo usa pesos actuales constantes: es un ejercicio hipotético, no el rendimiento real ni una predicción.
- Carteras y alertas no se sincronizan entre dispositivos (usar respaldo).
- Herramienta de análisis; no constituye asesoramiento financiero.
