import pandas as pd # requires installation of pandas `pip install pandas` (not installed in requirements because it is not necessary in the app)
import firebase_admin
from firebase_admin import credentials, firestore
import os
import sys

KEY_PATH = "../serviceAccountKey.json"
CSV_PATH = "./teams.csv"

def init_firebase():
    if not os.path.exists(KEY_PATH):
        print(f"Error: No se encontró {KEY_PATH}. Asegurate de estar corriendo esto desde la carpeta 'scripts'.")
        sys.exit(1)
    
    try:
        cred = credentials.Certificate(KEY_PATH)
        firebase_admin.initialize_app(cred)
        print("✅ Firebase conectado exitosamente.")
    except ValueError:
        # Si ya estaba inicializado, no pasa nada
        pass
    return firestore.client()

def import_data():
    db = init_firebase()
    
    if not os.path.exists(CSV_PATH):
        print(f"Error: No se encontró el CSV en {CSV_PATH}")
        return

    print(f"📖 Leyendo archivo: {CSV_PATH}...")
    df = pd.read_csv(CSV_PATH)
    
    # Cache de categorías para no leer la DB mil veces
    # Mapa: { "Nombre Categoria": "ID_Documento" }
    categories_ref = db.collection('categories')
    # existing_cats = {cat.to_dict().get('name'): cat.id for cat in categories_ref.stream()}
    existing_cats = [cat.id for cat in categories_ref.stream()]

    teams_ref = db.collection('teams')
    count_created = 0
    count_skipped = 0

    for index, row in df.iterrows():
        # Limpieza de datos (strip quita espacios en blanco extra)
        cat_id = str(row['Categoria']).strip()
        team_name = str(row['Nombre del Equipo']).strip()
        flag_url = str(row['Bandera']).strip()

        # 1. Gestión de Categoría
        if cat_id in existing_cats:
            # cat_id = existing_cats[cat_name]
            pass
        else:
            # print(f"🆕 Creando categoría nueva: {cat_name}")
            # # Creamos la categoría y guardamos su ID
            # new_cat_ref = categories_ref.add({
            #     'name': cat_name,
            #     'order': 99 # Orden por defecto, después lo podés editar en DB
            # })[1]
            # cat_id = new_cat_ref.id
            # existing_cats[cat_name] = cat_id # La agregamos al cache local
            raise ValueError(f"La categoría {cat_id} no existe en la lista de categorías disponibles. Agregala antes de continuar.")

        # 2. Gestión de Equipo
        # Verificamos si ya existe para no duplicar
        # (Buscamos por nombre Y categoría para ser precisos)
        query = teams_ref.where('name', '==', team_name).where('category_id', '==', cat_id).limit(1).stream()
        if any(query):
            print(f"⏭️  Saltando {team_name} (ya existe)")
            count_skipped += 1
            continue

        # Crear equipo
        teams_ref.add({
            'name': team_name,
            'flag': flag_url,
            'category_id': cat_id
        })
        print(f"✅ Cargado: {team_name}")
        count_created += 1

    print(f"\n--- Resumen ---")
    print(f"Equipos cargados: {count_created}")
    print(f"Equipos omitidos: {count_skipped}")
    print("----------------")

if __name__ == "__main__":
    import_data()