# Contexto y requerimientos — DeportNet Dashboard

Archivo vivo para que asistentes y desarrolladores retomen **qué pediste** y **qué quedó hecho**.  
**Cómo usarlo:** al pedir un cambio, podés decir *«actualizá CONTEXTO-REQUERIMIENTOS»* y se agrega una entrada abajo.

---

## Resumen del producto

- Dashboard que consume reportes de **DeportNet** (Playwright en backend, UI en React/MUI).
- Reportes con streaming SSE; ocupación: **una sucursal** por corrida, rango de fechas acotado (máx. 15 días en DeportNet).

---

## Historial (más reciente arriba)

### 2025-03-23 — Registro de requerimientos

- **Pedido:** Un archivo donde ir trackeando requerimientos y solicitudes para mantener contexto entre conversaciones.
- **Hecho:** Este documento (`CONTEXTO-REQUERIMIENTOS.md`).

### 2025-03-23 — Reporte de ocupación (porcentaje + limpieza UI)

- **Pedido:** En la tabla de ocupación, mostrar **% de ocupación** asumiendo **hasta 10 socios por turno/clase**, en lugar del número bruto de turnos/filas; sacar de la pantalla la información de **debug/diagnóstico** una vez que el reporte funciona.
- **Hecho:**
  - Backend: conteo de **fechas únicas por celda** (sesiones en el período), cálculo coherente con cupo configurable (`OCUPACION_CAPACIDAD_TURNO`, default 10).
  - Frontend: celdas y totales Σ en %; tooltips con socios/clases/cupo; texto de ayuda acortado.
  - API stream: no se envía `diagnostico` al cliente (sigue en servidor / archivos debug).
- **Nota técnica:** Si hubiera dos clases el mismo día y hora, hoy se cuenta una sesión por celda; refinable si hace falta.

### 2025-03-23 — Reporte de ocupación colgado

- **Pedido / problema:** El reporte se quedaba en *«Buscando datos en DeportNet…»* sin avanzar.
- **Estado:** Investigación en código en torno a `reporteOcupacionClases.js` y el flujo SSE (si vuelve a ocurrir, revisar red, credenciales, timeouts y logs del backend).

---

## Preferencias detectadas

- Comunicación en **español**.
- Cambios **acotados** al pedido; no expandir alcance sin consultar.

---

## Pendientes explícitos

*(Nada por ahora — completar cuando surjan tareas abiertas.)*
