# 🏐 Volleyball Scorer (v0.2)

App web simple para gestionar y ver puntajes de un torneo de voley en tiempo real, construida con FastAPI, Firestore y deployada en Google Cloud Run.

Esta aplicación se compone de dos partes principales:
1.  **Panel Manager (`/manager`):** Una interfaz de administración protegida por contraseña para crear partidos, sumar puntos y finalizar sets/partidos.
2.  **Panel Watcher (`/` y `/game`):** Un lobby público (`/`) que muestra todos los partidos en tiempo real y una vista de detalle (`/game?id=...`) que muestra el historial de puntos de un partido específico.

---

## 🚀 Stack Tecnológico

* **Backend:** Python 3.10+, **FastAPI**
* **Servidor:** **Uvicorn**
* **Base de Datos:** Google **Firestore** (en modo Datastore)
* **Frontend:** HTML5, **Tailwind CSS** (vía Play CDN), **Firebase JS SDK** (para real-time)
* **Plataforma de Deploy:** **Google Cloud Run**
* **Dependencias de Python:** `uv` (para gestión de paquetes)

---

## ✨ Características (v0.2)

### Panel Watcher (Público)

* **Lobby (`/`):**
    * Muestra 3 listas separadas: "En Vivo", "Próximos" y "Finalizados".
    * Los scores de los partidos "En Vivo" se actualizan en **tiempo real** sin necesidad de refrescar.
    * Cada tarjeta de partido es un link a la vista de detalle.
* **Vista de Partido (`/game?id=...`):**
    * Muestra un encabezado con el score principal, que se actualiza en **tiempo real**.
    * Muestra **pestañas (Tabs)** por cada set (incluyendo sets finalizados y anulados).
    * Al hacer clic en una pestaña, carga el **historial de puntos** de ese set, ordenado del más nuevo al más viejo.
    * La tabla de historial resalta visualmente (en amarillo) qué equipo anotó cada punto.

### Panel Manager (Admin)

* **Creación de Partidos:**
    * Formulario para crear un nuevo partido seleccionando equipos de una lista cargada desde Firestore.
* **Gestión de Partidos "En Vivo":**
    * Layout de tabla claro que muestra el score y N° de set actual para cada partido.
    * **+1 Punto:** Suma un punto al set *actual*. El score se actualiza en el manager sin recargar la tarjeta.
    * **+1 Set (Finalizar Set):** Declara un ganador para el set *actual* y crea automáticamente el siguiente set.
    * **Ganador (Finalizar Partido):** Declara un ganador para el partido y lo mueve a la lista de "Finalizados" (desaparece del manager).
* **Acciones de Administración:**
    * **Deshacer Último Punto:** Revierte el último punto anotado en el set *actual*. El score se actualiza sin recargar.
    * **Anular Set:** Marca el set *actual* como "cancelled", lo resetea a 0-0 y crea automáticamente el siguiente.
    * **Anular Partido:** Marca el partido como "cancelled" y lo quita de la lista de gestión.

---

## 📋 Estructura del Proyecto

```
.
├── static/
│   ├── index.html          # Lobby (Watcher)
│   ├── watcher_game.html   # Vista de partido (Watcher)
│   ├── manager.html        # Panel de Administración
│   └── setup_firebase.js   # (Opcional) Config pública de Firebase
│
├── .venv/                  # Entorno virtual de Python
├── main.py                 # Servidor FastAPI (API y servido de estáticos)
├── models.py               # Modelos de datos Pydantic
├── requirements.txt        # Dependencias de Python
├── Dockerfile              # Configuración para Cloud Run
└── serviceAccountKey.json  # Credenciales de Admin de Firebase (¡EN .gitignore!)
```

---

## 🏃 Puesta en Marcha (Local)

1.  **Clonar el Repositorio**
    ```bash
    git clone [URL_DEL_REPO]
    cd [NOMBRE_DEL_REPO]
    ```

2.  **Configurar Google Cloud / Firebase**
    * Crea un proyecto en [Google Cloud Console](https://console.cloud.google.com/) y habilita la API de **Firestore**.
    * En Firestore, crea una base de datos en Modo Nativo (`(default)`).
    * Ve a **IAM y Administración** > **Cuentas de servicio**, crea una nueva cuenta, asígnale el rol `Editor de Cloud Datastore`, y descarga la clave JSON. Renómbrala a `serviceAccountKey.json` y colócala en la raíz del proyecto. **(¡Añade `serviceAccountKey.json` a tu `.gitignore`!)**
    * Ve a [Firebase Console](https://console.firebase.google.com/), "Agrega un proyecto" y selecciona tu proyecto de GCP.
    * Registra una nueva "App Web" (ícono `</>`).
    * Copia el objeto `firebaseConfig`.

3.  **Configurar Frontend**
    * Pega el objeto `firebaseConfig` en `static/index.html` y `static/watcher_game.html` (o en un `static/setup_firebase.js` importado). **Esta clave es pública** y es seguro subirla a GitHub.

4.  **Configurar Reglas de Firestore**
    * En la consola de Firebase > Firestore Database > Reglas, pega las siguientes reglas:
    ```javascript
    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        match /{document=**} {
          allow read: if true;
          allow write: if false; // Solo el backend puede escribir
        }
      }
    }
    ```

5.  **Poblar Datos Iniciales**
    * En la consola de Firestore, crea la colección `teams`.
    * Añade documentos con la estructura: `{"name": "Nombre del Equipo", "flag": "🇦🇷"}`.

6.  **Instalar y Correr (usando `uv`)**
    ```bash
    # Crear entorno virtual
    python -m venv .venv
    
    # Activar (macOS/Linux)
    source .venv/bin/activate
    # Activar (Windows)
    # .\.venv\Scripts\activate
    
    # Instalar uv (si no lo tienes)
    pip install uv
    
    # Instalar dependencias
    uv pip install -r requirements.txt
    
    # ¡Correr el servidor!
    uvicorn main:app --reload
    ```

7.  **Acceder a la App**
    * **Manager:** `http://127.0.0.1:8000/manager`
        * Usuario/Pass: `manager`/`voley123` (hardcodeados en `main.py` para desarrollo).
    * **Lobby:** `http://127.0.0.1:8000/`

---

## 🐳 Deploy en Cloud Run

1.  Asegúrate de tener `gcloud` CLI instalado y configurado (`gcloud init`).
2.  (Recomendado) Sube tu código a un repositorio (GitHub, GitLab, etc.).
3.  Despliega el servicio **directamente desde la fuente**:
    ```bash
    gcloud run deploy volleyball-scorer \
      --source . \
      --platform managed \
      --region [TU_REGION] \
      --allow-unauthenticated \
      --set-env-vars="ADMIN_USER=tu_user_secreto,ADMIN_PASS=tu_pass_secreto"
    ```
4.  La primera vez, `gcloud` te preguntará por el nombre del servicio, la región, y habilitará las APIs necesarias (Cloud Build, Artifact Registry).
5.  **Importante:** La cuenta de servicio de Cloud Run necesitará permisos para escribir en Firestore. Ve a la consola de GCP -> IAM y Admin, busca la cuenta de servicio de tu Cloud Run (ej: `...compute@developer.gserviceaccount.com`) y asígnale el rol `Editor de Cloud Datastore`.