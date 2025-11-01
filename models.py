# models.py
import datetime
from pydantic import BaseModel, Field
from typing import Optional

# --- Modelos de Base de Datos ---

class Team(BaseModel):
    id: str # El ID del documento
    name: str
    flag: Optional[str] = None

class GameDocument(BaseModel):
    """Modelo para el documento que guardamos en 'games'"""
    team1_id: str
    team2_id: str
    team1_name: str # Denormalizado
    team2_name: str # Denormalizado
    status: str # "upcoming", "live", "finished"
    created_at: datetime.datetime
    winner_id: Optional[str] = None

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

class PointCreate(BaseModel):
    """
    Modelo para la request POST /manager/games/{game_id}/increment
    Este es el que faltaba.
    """
    set_number: int
    scoring_team_id: str # El ID del equipo que anotó (ej: "los_condores")