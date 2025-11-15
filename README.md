### `README.md` (v0.3)

````markdown
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
    * Lista de partidos activos con botón "Gestionar" individual.
* **Controlador de Partido (`/manager/game?id=...`):**
    * **Optimistic UI:** El marcador se actualiza instantáneamente al tocar un botón (sin esperar al servidor).
    * **Gestión Completa:** Sumar puntos, Finalizar Sets, Finalizar Partido.
    * **Corrección de Errores:** Deshacer último punto, Anular Set actual, Anular Partido completo.

---

## 📋 Estructura del Proyecto

```text
.
├── static/
│   ├── index.html          # Lobby (Watcher)
│   ├── watcher_game.html   # Vista de partido (Watcher)
│   ├── login.html          # Página de Login
│   ├── manager.html        # Dashboard del Manager (Lista)
│   ├── manager_game.html   # Controlador de Partido
│   └── no_flag.png         # Imagen fallback para equipos sin bandera
│
├── .venv/                  # Entorno virtual
├── main.py                 # Servidor FastAPI (Lógica de negocio y Auth)
├── models.py               # Modelos de datos Pydantic
├── requirements.txt        # Dependencias
├── Dockerfile              # Configuración para Cloud Run
└── serviceAccountKey.json  # Credenciales Admin (¡NO SUBIR A GIT!)
````

-----

## 🏃 Puesta en Marcha (Local)

### 1\. Clonar y Preparar

```bash
git clone [URL_DEL_REPO]
cd [NOMBRE_DEL_REPO]

# Crear entorno virtual e instalar dependencias
python -m venv .venv
source .venv/bin/activate  # o .\.venv\Scripts\activate en Windows
pip install uv
uv pip install -r requirements.txt
```

### 2\. Configuración de Google Cloud / Firebase

1.  **Proyecto:** Crea un proyecto en GCP y habilita **Firestore**.
2.  **Backend (Admin):**
      * Crea una Service Account en GCP con rol `Editor de Cloud Datastore`.
      * Descarga la key JSON, renómbrala a `serviceAccountKey.json` y ponla en la raíz.
      * **¡Importante\!** Agrega este archivo a tu `.gitignore`.
3.  **Frontend (Cliente):**
      * En la consola de Firebase, registra una Web App.
      * Copia el objeto `firebaseConfig`.
      * **Pégalo dentro** de las etiquetas `<script>` en `static/index.html` y `static/watcher_game.html`.

### 3\. Poblar la Base de Datos (Requisito v0.3)

Para que el sistema funcione, debes crear manualmente algunas estructuras en Firestore:

1.  **Colección `categories`:** Crea documentos con los campos:
      * `name` (string): ej: "Femenino A"
      * `order` (number): ej: 1
2.  **Colección `teams`:** Crea documentos para los equipos:
      * `name` (string): "Nombre Equipo"
      * `flag` (string): URL de la imagen de la bandera.
      * `category_id` (string): ID del documento de la categoría correspondiente.

### 4\. Ejecutar

```bash
uvicorn main:app --reload
```

### 5\. Accesos

  * **Lobby:** `http://127.0.0.1:8000/`
  * **Manager:** `http://127.0.0.1:8000/login`
      * Credenciales (Default): `manager` / `voley123` (Modificar `ADMIN_USER` y `ADMIN_PASS` en `main.py`).

-----

## 🐳 Deploy en Cloud Run

1.  Subir código al repositorio.
2.  Ejecutar deploy:
    ```bash
    gcloud run deploy volleyball-scorer \
      --source . \
      --platform managed \
      --region [TU_REGION] \
      --allow-unauthenticated
    ```
3.  **Permisos:** Asegúrate de que la Service Account que usa Cloud Run tenga el rol **Editor de Cloud Datastore** en IAM.

-----

## 🔒 Seguridad y Reglas

Asegúrate de configurar las reglas de Firestore en la consola de Firebase para permitir lectura pública pero escritura solo vía backend:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```