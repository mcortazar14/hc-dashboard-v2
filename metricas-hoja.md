# Métricas — HC Metrics Tracker

Documentado el 2026-10-22. El dashboard nuevo debe calcular con EXACTAMENTE estas reglas.
La hoja HC Metrics Tracker NO se toca — se llena manualmente por el equipo.

Sheet ID: `1WC22XiU199p8N8L8a2i0wtrynqT7j49_o-A3fhpQsfc`

---

## Métricas del WEEKLY TRACKER

### 1. Real conversations (conversaciones reales)
Son 3 fuentes válidas — cualquiera cuenta:
- **Llamada GHL ≥ 120 segundos** (outbound, manual, no workflow/campaign) — campo `meta.call.duration`
- **Check-in realizado** (Calendar/Fathom) donde el cliente asistió — status = 'realizado'
- **Upsell Tracker** — columna "Client Responded" = Yes, con fecha de "Last External Contact" dentro del período

Una conversación por cliente por semana máximo (no se acumula si hay varias).

### 2. Upsell pitches opened
Cuenta **una sola vez por cliente**: la primera vez que ese cliente llega a etapa `Pitched`, `Active` o `Closed` en el Upsell Tracker.
- Si un cliente ya estaba en Pitched antes del período → NO cuenta en ese período
- Se usa la tabla `upsell_history` para saber cuándo fue la primera vez

### 3. Deals closed
Clientes que en el período pasaron a etapa `Active` o `Closed` en el Upsell Tracker (primera vez en esa etapa).

### 4. Close rate
`Deals closed / Upsell pitches opened` para el mismo período. Se muestra como porcentaje.

### 5. Revenue collected ($)
No calculado automáticamente en la hoja — se ingresa manualmente. El dashboard puede mostrarlo desde Supabase si se agrega un campo de ingreso por cliente.

### 6. Check-ins completed
Total de check-ins con status = 'realizado' en el período (fuente: tabla `checkins`).

### 7. No-shows registered
Total de check-ins con status = 'no_realizado' en el período.

### 8. Unique clients / week
Clientes distintos con alguna actividad (mensaje GHL outbound o check-in) en la semana.

### 9. Outreach actions / week
Total de mensajes GHL outbound (SMS + llamadas, independientemente de duración) en la semana.

---

## Targets del WEEKLY TRACKER

Los targets son proporcionales al portafolio de cada HC (calculados en la pestaña CONFIG).

Fórmula de conversaciones target por semana:
- Month 1 clients × 1 conv/semana
- Month 2 clients × 0.5 conv/semana  
- Month 3+ clients × 0.25 conv/semana (1 conv/mes ÷ 4 semanas)
- On Hold × 0.1 conv/semana
- Canceled × 0.075 conv/semana

El dashboard calcula el target proporcional basándose en cuántos clientes Open tiene cada HC respecto al total.

---

## Fuentes de datos por métrica

| Métrica | Fuente en Supabase |
|---------|--------------------|
| Conversaciones | `messages` (calls ≥120s) + `checkins` (realizado) + `upsell_stages` (client_responded) |
| Pitches | `upsell_history` (primera vez en Pitched/Active/Closed) |
| Deals | `upsell_history` (primera vez en Active/Closed) |
| Check-ins | `checkins` |
| Outreach | `messages` (count, todos los outbound) |
| Clientes únicos | `clients` + `messages` (distinct client_id) |

---

## Selector de período

El dashboard recalcula todo para cualquier rango porque:
- `messages.date_added` guarda la fecha de cada mensaje
- `checkins.checkin_date` guarda la fecha de cada check-in
- `upsell_history.changed_at` guarda cuándo cambió la etapa

Períodos disponibles: Esta semana / Semana pasada / Este mes / Mes pasado / Rango personalizado.
Semana = lunes a domingo. Mes = día 1 al último día del mes.
