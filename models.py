# models.py
import datetime
from pydantic import BaseModel, Field
from typing import Optional

# --- Modelos de Base de Datos ---

class Category(BaseModel): # <--- NUEVO
    id: str
    name: str
    order: int = 0 # Para ordenar en el selector (ej: 1 para A, 2 para B)

class Team(BaseModel):
    id: str
    name: str
    flag: Optional[str] = None 
    category_id: Optional[str] = None

class GameDocument(BaseModel):
    """Modelo para el documento que guardamos en 'games'"""
    team1_id: str
    team2_id: str
    team1_name: str
    team2_name: str
    status: str
    created_at: datetime.datetime
    winner_id: Optional[str] = None
    
    # Campos de Score en vivo
    current_set_number: int = 1
    current_team1_score: int = 0
    current_team2_score: int = 0
    team1_sets_won: int = 0             # Contador de sets ganados
    team2_sets_won: int = 0             # Contador de sets ganados

    category_name: Optional[str] = None # Denormalizado para mostrar en el lobby
    team1_flag: Optional[str] = None    # Denormalizado
    team2_flag: Optional[str] = None    # Denormalizado

class GameListResponse(GameDocument):
    id: str

class SetDocument(BaseModel):
    """Modelo para el sub-documento 'sets/{set_number}'"""
    set_number: int
    status: str # "live", "finished"
    team1_current_score: int
    team2_current_score: int
    winner_id: Optional[str] = None

class PointDocument(BaseModel):
    """Modelo para el sub-documento 'points/{point_id}'"""
    timestamp: datetime.datetime
    scoring_team_id: str # El ID del equipo que anotó
    team1_score_after: int # Score resultante
    team2_score_after: int # Score resultante


# --- Modelos de Request (API) ---

class GameCreate(BaseModel):
    """Modelo para la request POST /manager/games"""
    team1_id: str
    team2_id: str
    
    category_id: Optional[str] = None

class SetFinish(BaseModel):
    """Modelo para la request POST /manager/games/{game_id}/finish_set"""
    set_number: int
    winner_team_id: str

class SetCancel(BaseModel): # <--- (AÑADE ESTA CLASE)
    """Modelo para la request POST /manager/games/{game_id}/cancel_set"""
    set_number: int

class GameFinish(BaseModel):
    """Modelo para la request POST /manager/games/{game_id}/finish_game"""
    winner_team_id: str

class PointCreate(BaseModel):
    """
    Modelo para la request POST /manager/games/{game_id}/increment
    Este es el que faltaba.
    """
    set_number: int
    scoring_team_id: str # El ID del equipo que anotó (ej: "los_condores")