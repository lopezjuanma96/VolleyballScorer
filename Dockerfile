# Usar una imagen oficial de Python
FROM python:3.10-slim

# Establecer el directorio de trabajo
WORKDIR /app

# Copiar el archivo de requerimientos
COPY requirements.txt requirements.txt

# Instalar dependencias
RUN pip install --no-cache-dir -r requirements.txt

# Copiar todo el código de la app
COPY . .

# Exponer el puerto que usa Cloud Run (8080)
ENV PORT 8080

# Comando para correr la app con uvicorn
# El host 0.0.0.0 es crucial para que sea accesible
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]