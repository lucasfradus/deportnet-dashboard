# Puertos del proyecto (DeportNet Dashboard)

| Servicio | Puerto por defecto | Dónde se define |
|----------|------------------|-----------------|
| **Backend** (API Express) | **4000** | `backend/.env` → `PORT=4000` o `backend/src/index.js` → `process.env.PORT \|\| 4000` |
| **Frontend** (Vite en desarrollo) | **5173** | Vite usa 5173 si está libre; si está ocupado, prueba 5174, 5175… (lo ves en la consola al hacer `npm run dev`) |

El frontend en modo desarrollo llama al API en **`http://localhost:4000`** (ver `frontend/src/constants/reportDefs.js` → `resolveApiStreamUrl`).

---

## Cómo comprobar en Windows (PowerShell)

### 1. Ver si algo escucha en un puerto

**Puerto 4000 (backend):**
```powershell
netstat -ano | findstr :4000
```

**Puerto 5173 (Vite habitual):**
```powershell
netstat -ano | findstr :5173
```

Si hay líneas con `LISTENING`, el último número es el **PID** del proceso.

### 2. Saber qué programa es (por PID)

Sustituí `12345` por el PID que viste:
```powershell
Get-Process -Id 12345
```

### 3. Probar el backend en el navegador

Con el backend corriendo, abrí:

- `http://localhost:4000` → puede dar 404 “Cannot GET /” (normal si no hay ruta raíz).
- Probar un stream (ejemplo; ajustá fechas y sede):

```
http://localhost:4000/api/report/ocupacion/stream?desde=2026-03-01&hasta=2026-03-15&sede=CLIC%20Pilates%20-%20Palermo%20Hollywood
```

Si el backend está bien, no debería ser el HTML `Cannot GET /api/report/ocupacion/stream` (ese error indica que **no** está registrada esa ruta en el proceso que escucha en 4000).

### 4. Consola al arrancar

- **Backend:** debería mostrar algo como: `Backend escuchando en http://localhost:4000`
- **Frontend:** debería mostrar la URL local, por ejemplo: `http://localhost:5173/`

---

## Cambiar el puerto del backend

En `backend/.env`:
```env
PORT=4000
```

O al arrancar:
```powershell
$env:PORT=5000; npm run dev
```
(recordá actualizar `VITE_API_ORIGIN` o el código que apunta a `localhost:4000` si usás otro puerto de forma fija.)

---

## Resumen rápido

1. Abrí **dos** terminales: una en `backend` (`npm run dev`) y otra en `frontend` (`npm run dev`).
2. Confirmá con `netstat` que **4000** y **5173** (o el que indique Vite) están en `LISTENING`.
3. Si el front no habla con el API, revisá que el backend sea el de este repo y que muestre el mensaje de escucha en **4000**.

---

## `Cannot GET /api/report/ocupacion/stream` (HTML de Express)

Ese mensaje es un **404 de Express**: la petición llega a **un** servidor Node/Express, pero **esa app no tiene registrada** esa ruta.

En el código de **este** repo la ruta **sí existe** (`backend/src/index.js`). Si igual ves 404, casi siempre es porque el proceso en el puerto **4000** **no es** el backend de este proyecto (otra carpeta, código viejo en memoria, u otro programa).

### Comprobación rápida

1. En el navegador abrí: **`http://localhost:4000/api/ping`**  
   - **Correcto:** JSON tipo `{ "ok": true, "service": "deportnet-dashboard-backend", ... }`  
   - **404 u otro:** el proceso en 4000 **no** es este backend → cerrá ese Node y en la carpeta **`deportnet-dashboard/backend`** ejecutá: `npm run dev`

2. Ver **qué archivo** arrancó Node (sustituí `18836` por tu PID del `netstat`):

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId = 18836" | Select-Object -ExpandProperty CommandLine
```

Debería aparecer algo como `...node...src\index.js`. Si el path es otra carpeta, es el servidor equivocado.

3. **Reiniciar** el backend siempre desde la carpeta del proyecto:

```powershell
cd C:\ruta\a\deportnet-dashboard\backend
npm run dev
```

No uses `node index.js` en la raíz del backend si `package.json` apunta a `node src/index.js` (el `main` del package es orientativo; los scripts usan `src/index.js`).
