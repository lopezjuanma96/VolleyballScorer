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
    Team, GameCreate, GameDocument, GameListResponse, GameFinish, SetDocument, SetFinish, PointCreate, PointDocument
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
            winner_id=None,
            current_set_number=1,
            current_team1_score=0,
            current_team2_score=0
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


@app.get("/manager/games/list", response_model=List[GameListResponse]) # <--- 2. USA EL NUEVO RESPONSE_MODEL
def get_games_list(username: str = Depends(get_current_user)):
    """
    Trae una lista de partidos que están 'upcoming' o 'live'
    para que el manager pueda gestionarlos.
    """
    try:
        games_ref = db.collection("games").where(
            filter=firestore.FieldFilter("status", "!=", "finished")
        ).order_by("created_at", direction=firestore.Query.DESCENDING).stream()

        games = []
        for game in games_ref:
            game_data = game.to_dict()
            game_data["id"] = game.id 
            
            # 3. USA EL NUEVO MODELO AL PARSEAR
            games.append(GameListResponse(**game_data)) 
        
        return games
    except Exception as e:
        print(f"Error al listar partidos: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno del servidor: {e}")


@app.post("/manager/games/{game_id}/finish_set", response_model=SetDocument)
def finish_set(game_id: str, set_data: SetFinish, username: str = Depends(get_current_user)):
    """
    Marca un set como finalizado y (opcionalmente) crea el siguiente.
    """
    
    game_ref = db.collection("games").document(game_id)
    set_ref = game_ref.collection("sets").document(str(set_data.set_number))

    try:
        @firestore.transactional
        def finish_set_in_transaction(transaction):
            game_snapshot = game_ref.get(transaction=transaction)
            set_snapshot = set_ref.get(transaction=transaction)

            if not game_snapshot.exists or not set_snapshot.exists:
                return None # Indicará que el partido o set no existe

            game_data = game_snapshot.to_dict()

            # Validar que el ganador sea parte del partido
            if set_data.winner_team_id not in [game_data["team1_id"], game_data["team2_id"]]:
                return None # Ganador inválido

            # 1. Actualizar el set actual
            transaction.update(set_ref, {
                "status": "finished",
                "winner_id": set_data.winner_team_id
            })

            # 2. Crear el *siguiente* set (Punto 3 de nuestro plan)
            # Asumimos que no es un partido a 5 sets, el manager lo parará manualmente
            next_set_number = set_data.set_number + 1
            next_set_ref = game_ref.collection("sets").document(str(next_set_number))
            
            new_set_doc = SetDocument(
                set_number=next_set_number,
                status="live", # El nuevo set arranca 'live'
                team1_current_score=0,
                team2_current_score=0,
                winner_id=None
            )
            transaction.set(next_set_ref, new_set_doc.model_dump())
            
            # 3. Actualizar el documento 'game' con el nuevo set y scores en 0
            transaction.update(game_ref, {
                "current_set_number": next_set_number,
                "current_team1_score": 0,
                "current_team2_score": 0
            })
            
            # Devolvemos el *nuevo* set creado
            return new_set_doc 

        # --- Fin de la transacción ---
        
        transaction_result = finish_set_in_transaction(db.transaction())

        if transaction_result is None:
            raise HTTPException(
                status_code=400, 
                detail="No se pudo finalizar el set. El ID del equipo, partido o set no son válidos."
            )
        
        # Devolvemos el nuevo set que se creó
        return transaction_result

    except Exception as e:
        print(f"Error al finalizar set: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno del servidor: {e}")


# ---
# Endpoint 4: Finalizar Partido (¡NUEVO!)
# ---
@app.post("/manager/games/{game_id}/finish_game", response_model=GameDocument)
def finish_game(game_id: str, game_data: GameFinish, username: str = Depends(get_current_user)):
    """
    Marca un partido como finalizado.
    """
    game_ref = db.collection("games").document(game_id)

    try:
        # 1. Leer el partido
        game_snapshot = game_ref.get()
        if not game_snapshot.exists:
            raise HTTPException(status_code=404, detail="El partido no existe.")
        
        game_dict = game_snapshot.to_dict()

        # 2. Validar ganador
        if game_data.winner_team_id not in [game_dict["team1_id"], game_dict["team2_id"]]:
            raise HTTPException(status_code=400, detail="El ID del equipo ganador no es válido.")

        # 3. Actualizar el documento
        game_ref.update({
            "status": "finished",
            "winner_id": game_data.winner_team_id
        })
        
        # 4. Devolver el estado final del partido
        # Para evitar otra lectura, actualizamos el dict que ya teníamos
        game_dict["status"] = "finished"
        game_dict["winner_id"] = game_data.winner_team_id
        return game_dict

    except Exception as e:
        print(f"Error al finalizar partido: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno del servidor: {e}")


@app.post("/manager/games/{game_id}/increment", status_code=status.HTTP_201_CREATED, response_model=PointDocument)
def increment_score(game_id: str, point: PointCreate, username: str = Depends(get_current_user)):
    """
    Incrementa el score de un equipo en un set específico usando una transacción.
    """
    
    # 1. Definir las referencias a los documentos
    game_ref = db.collection("games").document(game_id)
    set_ref = game_ref.collection("sets").document(str(point.set_number))
    # Es la referencia a la *colección* donde guardaremos el historial
    points_collection_ref = set_ref.collection("points")

    try:
        # 2. @firestore.transactional es un decorador que "envuelve" la función
        # en una transacción. Si la función falla, la transacción hace rollback.
        @firestore.transactional
        def update_score_in_transaction(transaction):
            
            # 3. Leer los documentos *dentro* de la transacción
            game_snapshot = game_ref.get(transaction=transaction)
            set_snapshot = set_ref.get(transaction=transaction)

            if not game_snapshot.exists or not set_snapshot.exists:
                # No podemos lanzar HTTPException desde aquí, así que retornamos None
                # para indicar que falló y lo manejamos afuera.
                return None

            game_data = game_snapshot.to_dict()
            set_data = set_snapshot.to_dict()

            # 4. Calcular el nuevo score
            current_score_t1 = set_data.get("team1_current_score", 0)
            current_score_t2 = set_data.get("team2_current_score", 0)
            
            new_score_t1 = current_score_t1
            new_score_t2 = current_score_t2

            if point.scoring_team_id == game_data.get("team1_id"):
                new_score_t1 += 1
            elif point.scoring_team_id == game_data.get("team2_id"):
                new_score_t2 += 1
            else:
                # El ID del equipo que anotó no pertenece a este partido
                return None

            # 5. Preparar el nuevo documento de historial de punto
            new_point_doc = PointDocument(
                timestamp=datetime.datetime.now(datetime.timezone.utc),
                scoring_team_id=point.scoring_team_id,
                team1_score_after=new_score_t1,
                team2_score_after=new_score_t2
            )

            # 6. Ejecutar las escrituras (aún dentro de la transacción)
            
            # A. Escribir el nuevo punto en la subcolección 'points'
            # (Creamos una referencia a un documento nuevo)
            new_point_ref = points_collection_ref.document()
            transaction.set(new_point_ref, new_point_doc.model_dump())

            # B. Actualizar el score denormalizado en el documento 'set'
            transaction.update(set_ref, {
                "team1_current_score": new_score_t1,
                "team2_current_score": new_score_t2,
                "status": "live" # Aseguramos que el set esté 'live' si se puntúa
            })

            # C. Actualizar el score denormalizado en el documento 'game' (para el lobby)
            transaction.update(game_ref, {
                "current_set_number": point.set_number,
                "current_team1_score": new_score_t1,
                "current_team2_score": new_score_t2,
                "status": "live" # Aseguramos que el partido esté 'live'
            })

            # 7. Retornar el documento del punto creado
            return new_point_doc

        # --- Fin de la función de transacción ---

        # 8. Ejecutar la transacción
        # Pasamos la transacción de la base de datos a nuestra función decorada
        transaction_result = update_score_in_transaction(db.transaction())

        # 9. Manejar el resultado
        if transaction_result is None:
            raise HTTPException(
                status_code=400, 
                detail="No se pudo anotar el punto. El ID del equipo, el partido o el set no son válidos."
            )

        # ¡Éxito! Retornamos el documento del punto que se creó
        return transaction_result

    except Exception as e:
        print(f"Error al incrementar score: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno del servidor: {e}")


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