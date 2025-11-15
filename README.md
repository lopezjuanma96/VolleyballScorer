# 🏐 Volleyball Scorer (v0.3)

App web progresiva para gestionar y visualizar puntajes de torneos de voley en tiempo real. Construida con **FastAPI**, **Google Firestore** y **Tailwind CSS**.

Esta versión introduce gestión por categorías, autenticación por cookies, interfaz optimista para el manager y visualización rica (banderas, sets ganados) para los espectadores.

---

## 🚀 Stack Tecnológico

* **Backend:** Python 3.10+, **FastAPI**
* **Servidor:** **Uvicorn**
* **Base de Datos:** Google **Firestore** (Modo Nativo)
* **Frontend:** HTML5, **Tailwind CSS** (Play CDN), **Firebase JS SDK** (Real-time)
* **Infraestructura:** Google **Cloud Run** (Serverless)
* **Gestión de Paquetes:** `uv`

---

## ✨ Características (v0.3)

### 🔐 Autenticación & Seguridad
* **Login Separado:** Página dedicada de inicio de sesión (`/login`).
* **Cookies HttpOnly:** Gestión de sesión segura mediante cookies (adiós a los popups de navegador).
* **Protección de Rutas:** Middleware que redirige a usuarios no autenticados fuera del panel de manager.

### 📺 Panel Watcher (Público)
* **Lobby (`/`):**
    * Listas en tiempo real: "En Vivo", "Próximos" y "Finalizados".
    * Visualización de **Categorías** y **Banderas** de los equipos.
    * Indicadores de **Sets Ganados** en cada tarjeta.
* **Vista de Partido (`/game?id=...`):**
    * Encabezado con banderas grandes y score global.
    * **Pestañas de Sets:** Navegación entre sets activos, finalizados y anulados.
    * **Historial de Puntos:** Tabla que carga bajo demanda, con resaltado visual (amarillo) del equipo que anotó.

### 👨‍💼 Panel Manager (Admin)
* **Dashboard (`/manager`):**
    * Filtrado de creación de partidos por **Categoría**.
    * Lista de partidos activos con botón "Gestionar