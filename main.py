import os
import secrets
import datetime
from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import List, Optional

# --- Firebase Admin Setup ---
import firebase_admin
from firebase_admin import credentials, firestore

# --- Importar Modelos ---
# Importamos todo desde nuestro nuevo archivo models.py
from models import (
    Team, GameCreate, GameDocument, SetDocument, PointCreate, PointDocument
)

try:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    print("Firebase inicializado con serviceAccountKey.json (Modo Local)")
except FileNotFoundError:
    firebase_admin.initialize_app()
    print("Firebase inicializado con credenciales de GCP (Modo Cloud Run)")

db = firestore.client()


# --- App y Seguridad ---
app = FastAPI()
security = HTTPBasic()

ADMIN_USER = "manager"
ADMIN_PASS = "voley123" # ¡Recuerda cambiar esto!

def get_current_user(credentials: HTTPBasicCredentials = Depends(security)):
    correct_user = secrets.compare_digest(credentials.username, ADMIN_USER)
    correct_pass = secrets.compare_digest(credentials.password, ADMIN_PASS)
    if not (correct_user and correct_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


# --- API Endpoints: Manager (Protegidos) ---

@app.get("/manager/test")
def read_manager_test(username: str = Depends(get_current_user)):
    return {"message": f"Hola {username}! Estás autenticado."}


@app.get("/manager/teams", response_model=List[Team])
def get_teams_list(username: str = Depends(get_current_user)):
    """Trae la lista de equipos para el manager."""
    teams_ref = db.collection("teams").stream()
    teams = []
    for team in teams_ref:
        team_data = team.to_dict()
        team_data["id"] = team.id
        teams.append(team_data)
    
    if not teams:
        raise HTTPException(
            status_code=404,
            detail="No se encontraron equipos. Asegúrate de popular la colección 'teams'."
        )
    return teams


@app.post("/manager/games", response_model=GameDocument)
def create_game(game: GameCreate, username: str = Depends(get_current_user)):
    """Crea un nuevo partido en Firestore."""
    
    if game.team1_id == game.team2_id:
        raise HTTPException(status_code=400, detail="Un equipo no puede jugar contra sí mismo.")

    try:
        team1_ref = db.collection("teams").document(game.team1_id).get()
        team2_ref = db.collection("teams").document(game.team2_id).get()

        if not team1_ref.exists or not team2_ref.exists:
            raise HTTPException(status_code=404, detail="Uno o ambos IDs de equipo no existen.")

        team1_name = team1_ref.to_dict().get("name", game.team1_id)
        team2_name = team2_ref.to_dict().get("name", game.team2_id)

        new_game_data = GameDocument(
            team1_id=game.team1_id,
            team2_id=game.team2_id,
            team1_name=team1_name,
            team2_name=team2_name,
            status="upcoming",
            created_at=datetime.datetime.now(datetime.timezone.utc),
            winner_id=None
        )

        update_time, game_ref = db.collection("games").add(new_game_data.model_dump())

        first_set_data = SetDocument(
            set_number=1,
            status="live",
            team1_current_score=0,
            team2_current_score=0,
            winner_id=None
        )
        
        db.collection("games").document(game_ref.id).collection("sets").document("1").set(
            first_set_data.model_dump()
        )

        print(f"Partido creado con ID: {game_ref.id}")
        return new_game_data

    except Exception as e:
        print(f"Error al crear partido: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno del servidor: {e}")


@app.post("/manager/games/{game_id}/increment", status_code=status.HTTP_201_CREATED)
def increment_score(game_id: str, point: PointCreate, username: str = Depends(get_current_user)):
    """
    Incrementa el score (placeholder).
    Ahora usa el modelo 'PointCreate' importado.
    """
    # Lógica a implementar (LA MÁS COMPLEJA):
    # 1. Iniciar una transacción de Firestore.
    # 2. Leer el documento de 'sets' (point.set_number)
    # 3. Leer el game_document para saber quién es team1 y team2
    # 4. Calcular el nuevo score.
    # 5. Escribir el nuevo documento en la subcolección 'points' (usando PointDocument).
    # 6. Actualizar el score denormalizado en el documento 'sets' (usando SetDocument).
    # 7. Commitear la transacción.
    print(f"Anotando punto para {point.scoring_team_id} en el set {point.set_number} del partido {game_id}")
    return {"status": "ok", "message": "Punto anotado (lógica pendiente)"}


# --- Servido de Frontend Estático ---

@app.get("/", include_in_schema=False)
async def get_index_html():
    return FileResponse("static/index.html")

@app.get("/game", include_in_schema=False)
async def get_watcher_game_html():
    return FileResponse("static/watcher_game.html")

@app.get("/manager", include_in_schema=False)
async def get_manager_html():
    return FileResponse("static/manager.html")

app.mount("/static", StaticFiles(directory="static"), name="static")