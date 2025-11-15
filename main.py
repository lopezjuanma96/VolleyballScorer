import os
import secrets
import datetime
from fastapi import FastAPI, Depends, HTTPException, status, Request, Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from typing import List, Optional

# --- Firebase Admin Setup ---
import firebase_admin
from firebase_admin import credentials, firestore

# --- Importar Modelos ---
# Importamos todo desde nuestro nuevo archivo models.py
from models import (
    Team, Category, GameCreate, GameDocument, SetDocument, PointCreate, PointDocument,
    GameListResponse, SetFinish, GameFinish, SetCancel,
    LoginRequest
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
COOKIE_NAME = "voley_session"


def get_current_user(request: Request):
    session_token = request.cookies.get(COOKIE_NAME)
    if not session_token or session_token != "authenticated_token_xyz":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado"
        )
    return "manager"


def verify_page_access(request: Request):
    session_token = request.cookies.get(COOKIE_NAME)
    if not session_token or session_token != "authenticated_token_xyz":
        # Si falla, lanzamos una excepción especial que capturaremos
        # o simplemente retornamos False y manejamos en la ruta
        return False
    return True


@app.post("/auth/login")
def login(creds: LoginRequest, response: Response):
    correct_user = secrets.compare_digest(creds.username, ADMIN_USER)
    correct_pass = secrets.compare_digest(creds.password, ADMIN_PASS)
    
    if not (correct_user and correct_pass):
        raise HTTPException(status_code=400, detail="Credenciales incorrectas")
    
    # Crear la cookie
    # httponly=True es vital: impide que el JS lea la cookie (seguridad XSS)
    response.set_cookie(
        key=COOKIE_NAME, 
        value="authenticated_token_xyz", # En un app real, usa un token firmado JWT
        httponly=True,
        max_age=3600 * 12 # 12 horas de duración
    )
    return {"message": "Login exitoso"}


@app.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"message": "Logout exitoso"}

# --- API Endpoints: Manager (Protegidos) ---

@app.get("/manager/test")
def read_manager_test(username: str = Depends(get_current_user)):
    return {"message": "Estás autenticado via Cookie!"}


@app.get("/manager/categories", response_model=List[Category])
def get_categories(username: str = Depends(get_current_user)):
    """Trae la lista de categorías ordenadas."""
    # Asegúrate de crear la colección 'categories' en Firestore
    cats_ref = db.collection("categories").order_by("order").stream()
    categories = []
    for cat in cats_ref:
        cat_data = cat.to_dict()
        cat_data["id"] = cat.id
        categories.append(cat_data)
    return categories


@app.get("/manager/teams", response_model=List[Team])
def get_teams_list(category_id: Optional[str] = None, username: str = Depends(get_current_user)):
    """
    Trae equipos. Si se pasa category_id, filtra.
    """
    teams_ref = db.collection("teams")
    
    if category_id:
        # Filtramos por el campo category_id
        teams_ref = teams_ref.where(filter=firestore.FieldFilter("category_id", "==", category_id))
        
    docs = teams_ref.stream()
    teams = []
    for team in docs:
        team_data = team.to_dict()
        team_data["id"] = team.id
        teams.append(team_data)
    
    return teams


@app.post("/manager/games", response_model=GameDocument)
def create_game(game: GameCreate, username: str = Depends(get_current_user)):
    if game.team1_id == game.team2_id:
        raise HTTPException(status_code=400, detail="Un equipo no puede jugar contra sí mismo.")

    try:
        # 1. Buscar datos de equipos
        team1_ref = db.collection("teams").document(game.team1_id).get()
        team2_ref = db.collection("teams").document(game.team2_id).get()

        if not team1_ref.exists or not team2_ref.exists:
            raise HTTPException(status_code=404, detail="Equipos no encontrados.")

        t1_data = team1_ref.to_dict()
        t2_data = team2_ref.to_dict()

        # 2. Buscar nombre de categoría (si se envió)
        cat_name = "Amistoso" # Default
        if game.category_id:
            cat_ref = db.collection("categories").document(game.category_id).get()
            if cat_ref.exists:
                cat_name = cat_ref.to_dict().get("name", "Torneo")

        # 3. Crear documento con los nuevos campos (Flags y Sets Won)
        new_game_data = GameDocument(
            team1_id=game.team1_id,
            team2_id=game.team2_id,
            team1_name=t1_data.get("name", "Equipo 1"),
            team2_name=t2_data.get("name", "Equipo 2"),
            
            # Guardamos las flags aquí para no buscarlas cada vez en el watcher
            team1_flag=t1_data.get("flag"), 
            team2_flag=t2_data.get("flag"),
            category_name=cat_name,

            status="upcoming",
            created_at=datetime.datetime.now(datetime.timezone.utc),
            
            current_set_number=1,
            current_team1_score=0,
            current_team2_score=0,
            
            # Inicializamos contadores de sets
            team1_sets_won=0,
            team2_sets_won=0
        )

        update_time, game_ref = db.collection("games").add(new_game_data.model_dump())

        # Crear set 1 (Igual que antes)
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

        return new_game_data

    except Exception as e:
        print(f"Error create_game: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/manager/games/list", response_model=List[GameListResponse]) # <--- 2. USA EL NUEVO RESPONSE_MODEL
def get_games_list(username: str = Depends(get_current_user)):
    """
    Trae una lista de partidos que están 'upcoming' o 'live'
    para que el manager pueda gestionarlos.
    """
    try:
        games_ref = db.collection("games").where(
            filter=firestore.FieldFilter("status", "in", ["upcoming", "live"])
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
    
    game_ref = db.collection("games").document(game_id)
    set_ref = game_ref.collection("sets").document(str(set_data.set_number))

    try:
        @firestore.transactional
        def finish_set_in_transaction(transaction):
            game_snapshot = game_ref.get(transaction=transaction)
            set_snapshot = set_ref.get(transaction=transaction)

            if not game_snapshot.exists or not set_snapshot.exists:
                return None

            game_data = game_snapshot.to_dict()

            if set_data.winner_team_id not in [game_data["team1_id"], game_data["team2_id"]]:
                return None 

            # 1. Actualizar el set (Igual que antes)
            transaction.update(set_ref, {
                "status": "finished",
                "winner_id": set_data.winner_team_id
            })

            # 2. Lógica NUEVA: Incrementar sets_won
            updates = {
                "current_set_number": set_data.set_number + 1,
                "current_team1_score": 0,
                "current_team2_score": 0
            }
            
            # Leemos los valores actuales (o 0 si es legacy)
            current_sets_t1 = game_data.get("team1_sets_won", 0)
            current_sets_t2 = game_data.get("team2_sets_won", 0)

            if set_data.winner_team_id == game_data["team1_id"]:
                updates["team1_sets_won"] = current_sets_t1 + 1
            else:
                updates["team2_sets_won"] = current_sets_t2 + 1
            
            transaction.update(game_ref, updates)

            # 3. Crear siguiente set (Igual que antes)
            next_set_number = set_data.set_number + 1
            next_set_ref = game_ref.collection("sets").document(str(next_set_number))
            
            new_set_doc = SetDocument(
                set_number=next_set_number,
                status="live", 
                team1_current_score=0,
                team2_current_score=0,
                winner_id=None
            )
            transaction.set(next_set_ref, new_set_doc.model_dump())
            
            return new_set_doc 

        # ... (resto del manejo de transacción igual) ...
        
        transaction_result = finish_set_in_transaction(db.transaction())
        
        if transaction_result is None:
             raise HTTPException(status_code=400, detail="Error al finalizar set.")
        
        return transaction_result

    except Exception as e:
        print(f"Error finish_set: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


@app.post("/manager/games/{game_id}/undo_point", status_code=status.HTTP_200_OK)
def undo_last_point(game_id: str, username: str = Depends(get_current_user)):
    """
    Deshace el último punto anotado en el set actual.
    """
    
    result = None
    message = "Error desconocido."
    try:
        @firestore.transactional
        def undo_in_transaction(transaction):
            # 1. Obtener el set actual
            game_ref = db.collection("games").document(game_id)
            game_snapshot = game_ref.get(transaction=transaction)
            if not game_snapshot.exists:
                return (None, "El partido no existe.")
            
            game_data = game_snapshot.to_dict()
            current_set_num = game_data.get("current_set_number", 1)
            
            set_ref = game_ref.collection("sets").document(str(current_set_num))
            points_collection_ref = set_ref.collection("points")

            # 2. Buscar los últimos 2 puntos
            last_two_points_query = points_collection_ref.order_by(
                "timestamp", direction=firestore.Query.DESCENDING
            ).limit(2)
            last_two_points = list(last_two_points_query.get(transaction=transaction))

            # 3. Determinar el estado anterior
            new_score_t1 = 0
            new_score_t2 = 0
            
            if len(last_two_points) == 0:
                return (None, "No hay puntos en este set para deshacer.")
            
            elif len(last_two_points) == 1:
                point_to_delete_ref = last_two_points[0].reference
            
            else:
                point_to_delete_ref = last_two_points[0].reference
                anteultimo_point_data = last_two_points[1].to_dict()
                new_score_t1 = anteultimo_point_data.get("team1_score_after", 0)
                new_score_t2 = anteultimo_point_data.get("team2_score_after", 0)

            # 4. Ejecutar las escrituras
            transaction.delete(point_to_delete_ref)
            transaction.update(set_ref, {
                "team1_current_score": new_score_t1,
                "team2_current_score": new_score_t2
            })
            transaction.update(game_ref, {
                "current_team1_score": new_score_t1,
                "current_team2_score": new_score_t2
            })
            
            return ({"team1_score": new_score_t1, "team2_score": new_score_t2}, "Punto deshecho.")

        # --- Fin de la transacción ---
        
        result, message = undo_in_transaction(db.transaction())
        
    except Exception as e:
        # Esto SÍ es un error interno
        print(f"Error al deshacer punto: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno del servidor: {e}")

    # Manejamos los 'None' (errores lógicos) FUERA del try/except
    if result is None:
        # Usamos 400 (Bad Request) o 404 (Not Found) según el 'message'
        status_code = 404 if "no existe" in message else 400
        raise HTTPException(status_code=status_code, detail=message)

    return {"status": "ok", "message": message, "new_scores": result}


@app.post("/manager/games/{game_id}/cancel_set", response_model=SetDocument)
def cancel_set(game_id: str, set_data: SetCancel, username: str = Depends(get_current_user)):
    """
    Marca un set como 'cancelled' y automáticamente crea el siguiente,
    actualizando el game doc.
    """
    
    game_ref = db.collection("games").document(game_id)
    set_ref = game_ref.collection("sets").document(str(set_data.set_number))

    try:
        @firestore.transactional
        def cancel_set_in_transaction(transaction):
            
            game_snapshot = game_ref.get(transaction=transaction)
            set_snapshot = set_ref.get(transaction=transaction)

            if not game_snapshot.exists or not set_snapshot.exists:
                return (None, "El partido o el set no existen.")

            # 1. Actualizar el set actual a 'cancelled'
            transaction.update(set_ref, {
                "status": "cancelled"
                # No necesitamos un 'winner_id'
            })

            # 2. Crear el *siguiente* set (igual que en finish_set)
            next_set_number = set_data.set_number + 1
            next_set_ref = game_ref.collection("sets").document(str(next_set_number))
            
            new_set_doc = SetDocument(
                set_number=next_set_number,
                status="live", 
                team1_current_score=0,
                team2_current_score=0,
                winner_id=None
            )
            transaction.set(next_set_ref, new_set_doc.model_dump())
            
            # 3. Actualizar el documento 'game' principal
            transaction.update(game_ref, {
                "current_set_number": next_set_number,
                "current_team1_score": 0,
                "current_team2_score": 0
            })
            
            # Devolvemos el *nuevo* set creado
            return (new_set_doc, "Set cancelado.")
        
        # --- Fin de la transacción ---
        
        result, message = cancel_set_in_transaction(db.transaction())

        if result is None:
            raise HTTPException(status_code=404, detail=message)
        
        # Devolvemos el SetDocument del *nuevo* set creado
        return result

    except Exception as e:
        print(f"Error al cancelar set: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno del servidor: {e}")


@app.post("/manager/games/{game_id}/cancel", status_code=status.HTTP_200_OK)
def cancel_game(game_id: str, username: str = Depends(get_current_user)):
    """
    Anula un partido cambiándole el estado a 'cancelled'.
    """
    try:
        game_ref = db.collection("games").document(game_id)
        game_snapshot = game_ref.get()

        if not game_snapshot.exists:
            raise HTTPException(status_code=404, detail="El partido no existe.")
        
        game_ref.update({"status": "cancelled"})
        
        return {"status": "ok", "message": "Partido anulado."}
    
    except Exception as e:
        print(f"Error al anular partido: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno del servidor: {e}")


# --- Servido de Frontend Estático ---

@app.get("/", include_in_schema=False)
async def get_index_html():
    return FileResponse("static/index.html")

@app.get("/game", include_in_schema=False)
async def get_watcher_game_html():
    return FileResponse("static/watcher_game.html")

@app.get("/login", include_in_schema=False)
async def get_login_html():
    return FileResponse("static/login.html")

# Esta ruta está PROTEGIDA con redirección
@app.get("/manager", include_in_schema=False)
async def get_manager_html(request: Request):
    if not verify_page_access(request):
        return RedirectResponse(url="/login")
    return FileResponse("static/manager.html")

app.mount("/static", StaticFiles(directory="static"), name="static")