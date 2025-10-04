# Cómo Obtener el DID del Issuer Node

## Paso 1: Iniciar el Issuer Node

El Issuer Node de Privado ID crea su propio DID automáticamente cuando lo inicias.

```bash
# Si usas Docker
cd path/to/issuer-node
docker-compose up -d

# Espera unos segundos a que inicie
```

## Paso 2: Verificar que el Issuer está corriendo

```bash
# Desde terminal
curl http://localhost:3001/health

# Debería responder algo como:
# {"status":"ok","version":"v2.0.0"}
```

## Paso 3: Obtener el DID del Issuer

### Opción 1: Usando curl
```bash
curl http://localhost:3001/v2/identities
```

### Opción 2: Usando tu backend
```bash
curl http://localhost:5000/api/issuer/info
```

### Opción 3: Desde el navegador
Visita: `http://localhost:3001/v2/identities`

## Respuesta esperada:

```json
[
  {
    "identifier": "did:polygonid:polygon:amoy:2qQ68JkRcf3xrHPQPWZei3YeVzHPP1eJFY...",
    "state": {
      "claimsTreeRoot": "0x...",
      "revocationTreeRoot": "0x...",
      "rootOfRoots": "0x..."
    },
    "balance": 0,
    "keyType": "BJJ"
  }
]
```

## Paso 4: (Opcional) Guardar el DID

El DID del Issuer está en el campo `identifier`.

**NO necesitas configurarlo en el .env**, el backend se comunica directamente con el Issuer Node a través de la URL `http://localhost:3001`.

## Flujo completo:

```
Frontend (React:3000)
    ↓
Backend (Express:5000)
    ↓
Issuer Node (Privado ID:3001)
    → Crea DIDs
    → Emite Credenciales
    → Genera pruebas ZKP
```

## Troubleshooting:

### Error: "No se pudo conectar con el Issuer Node"

**Solución 1**: Verifica que el Issuer Node esté corriendo
```bash
docker ps | grep issuer
# o
netstat -tuln | grep 3001
```

**Solución 2**: Verifica la URL en .env
```bash
cat .env | grep ISSUER_NODE_BASE_URL
# Debe ser: ISSUER_NODE_BASE_URL=http://localhost:3001
```

**Solución 3**: Verifica logs del Issuer
```bash
docker logs issuer-node-api
```

### Error: "Port 3001 already in use"

Otro servicio está usando el puerto 3001:
```bash
# Encontrar proceso
lsof -i :3001

# Matar proceso
kill -9 <PID>

# O cambiar puerto del Issuer en su docker-compose.yml
```

## Verificación final:

```bash
# 1. Backend corriendo
curl http://localhost:5000/health

# 2. Issuer corriendo
curl http://localhost:3001/health

# 3. Obtener DID del Issuer
curl http://localhost:5000/api/issuer/info

# 4. Crear un DID de prueba
curl -X POST http://localhost:5000/api/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"123456"}'
```

Si todo funciona correctamente, deberías recibir un DID como:
```
did:polygonid:polygon:amoy:2qXXXXXXXXXXXXXXXX...
```

## Documentación oficial:

- Privado ID Issuer Node: https://docs.privado.id/
- Polygon ID: https://polygon.technology/polygon-id
