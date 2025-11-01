# 🏐 Volleyball Scorer

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

## 📋 Estructura del Proyecto

```
.
├── static/
│   ├── index.html          # Lobby (Watcher)
│   ├── watcher_game.html   # Vista de partido (Watcher)
│   └── manager.html        # Panel de Administración
│
├── .venv/                  # Entorno virtual de Python
├── main.py                 # Servidor FastAPI (API y servido de estáticos)
├── models.py               # Modelos de datos Pydantic
├── requirements.txt        # Dependencias de Python
├── Dockerfile              # Configuración para Cloud Run
└── serviceAccountKey.json  # Credenciales de Admin de Firebase (NO SUBIR A GIT)
```

---

## 🏃 Puesta en Marcha (Local)

1.  **Clonar el Repositorio**
    ```bash
    git clone [URL_DEL_REPO]
    cd [NOMBRE_DEL_REPO]
    ```

2.  **Configurar Google Cloud / Firebase**
    * Crea un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
    * Habilita la API de **Firestore**.
    * En la consola de Firestore, crea una base de datos en Modo Nativo (`(default)`).
    * Ve a **IAM y Administración** > **Cuentas de servicio**, crea una nueva cuenta de servicio con el rol `Editor de Cloud Datastore`, y descarga la clave JSON. Renómbrala a `serviceAccountKey.json` y colócala en la raíz del proyecto.
    * Ve a [Firebase Console](https://console.firebase.google.com/), "Agrega un proyecto" y selecciona tu proyecto de GCP existente.
    * Registra una nueva "App Web" (ícono `</>`).
    * Copia el objeto `firebaseConfig` que te provee.

3.  **Configurar Frontend**
    * Pega el objeto `firebaseConfig` en `static/index.html` y `static/watcher_game.html` donde se indica.

4.  **Configurar Reglas de Firestore**
    * En la consola de Firebase > Firestore Database > Reglas, pega las siguientes reglas para permitir lectura pública:
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
        * Usuario: `manager`
        * Pass: `voley123` (¡Modificar en `main.py`!)
    * **Lobby:** `http://127.0.0.1:8000/`

---

## 🐳 Deploy en Cloud Run

1.  Asegúrate de tener `gcloud` CLI instalado y configurado (`gcloud init`).
2.  (Opcional) Sube tu imagen a Artifact Registry.
3.  Despliega el servicio:
    ```bash
    gcloud run deploy volleyball-scorer \
      --source . \
      --platform managed \
      --region [TU_REGION] \
      --allow-unauthenticated \
      --set-env-vars="ADMIN_USER=tu_user,ADMIN_PASS=tu_pass_segura"
    ```
4.  Asigna los permisos correctos a la Service Account de Cloud Run (ver [documentación de IAM](https://cloud.google.com/iam/docs/granting-changing-revoking-access)).