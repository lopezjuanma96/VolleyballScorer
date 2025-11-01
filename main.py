import os
import secrets
from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional

# --- Firebase Admin Setup ---
import firebase_admin
from firebase_admin import credentials, firestore

# IMPORTANTE: Para desarrollo local
# 1. Descarga tu "serviceAccountKey.json" desde Firebase
# 2. Guárdalo en la raíz del proyecto (¡y añádelo a .gitignore!)
# 3. Descomenta la línea de abajo:
# cred = credentials.Certificate("serviceAccountKey.json")
# firebase_admin.initialize_app(cred)

# IMPORTANTE: Para Cloud Run
# Cuando deployas en Cloud Run, él usa automáticamente los permisos
# de la Service Account del servicio (ver punto 1 de permisos).
# No necesitas el .json. `initialize_app()` lo detecta solo.
# Esta lógica try/except maneja ambos casos:
try:
    # Intenta inicializar con el .json local
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    print("Firebase inicializado con serviceAccountKey.json (Modo Local)")
except FileNotFoundError:
    # Si falla (porque estamos en Cloud Run y el .json no existe),
    # inicializa usando las credenciales "ambient" de GCP.
    firebase_admin.initialize_app()
    print("Firebase inicializado con credenciales de GCP (Modo Cloud Run)")

db = firestore.client()


# --- App y Seguridad ---
app = FastAPI()
security = HTTPBasic()

# --- Usuario y Pass Hardcodeados ---
# (Más adelante los podemos mover a variables de entorno)
ADMIN_USER = "manager"
ADMIN_PASS = "voley123" # ¡Cambia esto por algo más seguro!

def get_current_user(credentials: HTTPBasicCredentials = Depends(security)):
    """Dependencia de seguridad para endpoints /manager"""
    correct_user = secrets.compare_digest(credentials.username, ADMIN_USER)
    correct_pass = secrets.compare_digest(credentials.password, ADMIN_PASS)
    if not (correct_user and correct_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


# --- Modelos de Datos (Pydantic) ---

class Team(BaseModel):
    id: str = Field(..., alias="id") # El ID del documento
    name: str
    flag: Optional[str] = None # ej: "🇦🇷"

class GameCreate(BaseModel):
    """Modelo para crear un nuevo partido"""
    team1_id: str
    team2_id: str
    # Los nombres los buscaremos en la DB al momento de crear
    # para denormalizarlos.

class PointCreate(BaseModel):
    """Modelo para registrar un punto"""
    set_number: int
    team_to_increment_id: str # "team_a" o "team_b"


# --- API Endpoints: Manager (Protegidos) ---

@app.get("/manager/test")
def read_manager_test(username: str = Depends(get_current_user)):
    """Endpoint de prueba para verificar que la autenticación funciona"""
    return {"message": f"Hola {username}! Estás autenticado."}

@app.get("/manager/teams", response_model=list[Team])
def get_teams_list(username: str = Depends(get_current_user)):
    """Trae la lista de equipos para el manager (ej: para crear un partido)"""
    teams_ref = db.collection("teams").stream()
    teams = []
    for team in teams_ref:
        team_data = team.to_dict()
        team_data["id"] = team.id # Agregamos el ID del doc
        teams.append(team_data)
    return teams

@app.post("/manager/games")
def create_game(game: GameCreate, username: str = Depends(get_current_user)):
    """Crea un nuevo partido (placeholder)"""
    # Lógica a implementar:
    # 1. Leer los nombres de 'teams' usando game.team1_id y game.team2_id
    # 2. Crear el documento en la colección 'games' con los datos denormalizados
    # 3. Crear el sub-documento 'games/{id}/sets/1' con scores en 0
    print(f"Creando partido entre {game.team1_id} y {game.team2_id}")
    return {"status": "ok", "message": "Partido creado (lógica pendiente)"}

@app.post("/manager/games/{game_id}/increment")
def increment_score(game_id: str, point: PointCreate, username: str = Depends(get_current_user)):
    """Incrementa el score (placeholder)"""
    # Lógica a implementar (LA MÁS COMPLEJA):
    # 1. Iniciar una transacción de Firestore.
    # 2. Leer el documento de 'sets' (point.set_number)
    # 3. Calcular el nuevo score.
    # 4. Escribir el nuevo documento en la subcolección 'points'.
    # 5. Actualizar el score denormalizado en el documento 'sets'.
    # 6. Commitear la transacción.
    print(f"Anotando punto para {point.team_to_increment_id} en el set {point.set_number} del partido {game_id}")
    return {"status": "ok", "message": "Punto anotado (lógica pendiente)"}


# --- Servido de Frontend Estático ---
# Montamos la carpeta 'static' (donde vivirán nuestros html, css, js)
# NOTA: En un proyecto real, esto es /static, pero para servir
# los HTML principales lo hacemos con rutas explícitas.

@app.get("/", include_in_schema=False)
async def get_index_html():
    """Sirve el Lobby de Watcher (index.html)"""
    return FileResponse("static/index.html")

@app.get("/game", include_in_schema=False)
async def get_watcher_game_html():
    """Sirve la página de un partido específico (watcher_game.html)"""
    return FileResponse("static/watcher_game.html")

@app.get("/manager", include_in_schema=False)
async def get_manager_html():
    """Sirve la página del Manager"""
    # Esta página pedirá autenticación Basic
    return FileResponse("static/manager.html")

# Montamos el resto de assets (CSS, JS, etc.)
app.mount("/static", StaticFiles(directory="static"), name="static")