#!/usr/bin/env python3
"""Import teams through the same authenticated API. Standard library only."""
import argparse
import csv
import http.cookiejar
import json
import os
from pathlib import Path
import urllib.request
import urllib.error


def read_teams(filename):
    with open(filename, encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        if not {'Categoria', 'Club', 'Nombre del Equipo'}.issubset(reader.fieldnames or []):
            raise ValueError('Columnas obligatorias: Categoria,Club,Nombre del Equipo')
        rows = []
        for line, row in enumerate(reader, 2):
            values = tuple((row.get(field) or '').strip() for field in ['Categoria', 'Club', 'Nombre del Equipo'])
            if not all(values) or any(len(value) > 100 for value in values):
                raise ValueError(f'Fila {line}: los tres campos son obligatorios, hasta 100 caracteres.')
            if values not in rows:
                rows.append(values)
        return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv')
    parser.add_argument('--url', default='http://localhost:3000')
    parser.add_argument('--apply', action='store_true', help='Guardar; por defecto sólo valida y muestra el plan.')
    args = parser.parse_args()
    rows = read_teams(args.csv)
    print(f'{len(rows)} equipos únicos, {len(set(r[0] for r in rows))} categorías, {len(set(r[1] for r in rows))} clubes.')
    if not args.apply:
        print('CSV válido. Para importar, agregá --apply. No se modificó nada.')
        return
    username, password = os.environ.get('MANAGER_USER', 'manager'), os.environ.get('MANAGER_PASSWORD')
    if not password:
        raise ValueError('Definí MANAGER_PASSWORD en el entorno (sin ponerla en argumentos).')
    if not args.url.startswith('https://') and not args.url.startswith(('http://localhost:', 'http://127.0.0.1:')):
        raise ValueError('Usá HTTPS para servidores remotos.')
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(path, body=None, multipart=False):
        data = json.dumps(body).encode() if body is not None else None
        headers = {'Content-Type': 'application/json'} if body is not None else {}
        if multipart:
            boundary = 'volleyball-import-boundary'
            data = f'--{boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n{body["name"]}\r\n--{boundary}--\r\n'.encode()
            headers = {'Content-Type': f'multipart/form-data; boundary={boundary}'}
        req = urllib.request.Request(args.url.rstrip('/') + path, data=data, headers=headers)
        with opener.open(req, timeout=20) as response:
            return json.load(response)

    request('/api/auth/login', {'username': username, 'password': password})
    categories = {r['name']: r['id'] for r in request('/api/categories')}
    clubs = {r['name']: r['id'] for r in request('/api/clubs')}
    teams = {(r['categoryId'], r['clubId'], r['name']) for r in request('/api/teams')}
    created = 0
    try:
        for category, club, team in rows:
            if category not in categories:
                categories[category] = request('/api/categories', {'name': category})['id']
            if club not in clubs:
                clubs[club] = request('/api/clubs', {'name': club}, multipart=True)['id']
            key = (categories[category], clubs[club], team)
            if key in teams:
                continue
            request('/api/teams', {'categoryId': key[0], 'clubId': key[1], 'name': team})
            teams.add(key)
            created += 1
        print(f'Importación completa: {created} creados, {len(rows) - created} existentes.')
    finally:
        request('/api/auth/logout', {})


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, urllib.error.HTTPError) as error:
        raise SystemExit(f'No se pudo importar: {error}')
