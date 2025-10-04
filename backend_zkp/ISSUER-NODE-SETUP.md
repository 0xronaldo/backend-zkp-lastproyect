# 🚀 Configuración del Issuer Node (Privado ID)

## ⚠️ IMPORTANTE
El backend ahora funciona **CON o SIN** el Issuer Node:
- ✅ **CON Issuer Node**: Genera DIDs y credenciales oficiales blockchain
- ⚠️ **SIN Issuer Node**: Genera DIDs y credenciales locales temporales

## 📦 Opción 1: Docker (Recomendado)

### Paso 1: Instalar Docker
```bash
# Verificar si Docker está instalado
docker --version

# Si no está instalado (Ubuntu/Debian):
sudo apt update
sudo apt install docker.io docker-compose -y
sudo systemctl start docker
sudo systemctl enable docker

# Agregar tu usuario al grupo docker
sudo usermod -aG docker $USER
newgrp docker
```

### Paso 2: Descargar Privado ID Issuer Node
```bash
cd /home/ronaldo/Documentos/Proyects/
git clone https://github.com/0xPolygonID/issuer-node.git
cd issuer-node
```

### Paso 3: Configurar el Issuer Node
```bash
# Copiar archivo de ejemplo
cp .env-issuer.sample .env-issuer

# Editar configuración (opcional)
nano .env-issuer
```

Variables importantes en `.env-issuer`:
```env
ISSUER_SERVER_PORT=3001
ISSUER_DATABASE_URL=postgres://issuer:password@postgres:5432/issuer
ISSUER_KEY_STORE_ADDRESS=http://vault:8200
```

### Paso 4: Levantar el Issuer Node
```bash
# Iniciar todos los servicios
docker-compose up -d

# Ver logs en tiempo real
docker-compose logs -f issuer

# Verificar que esté corriendo
curl http://localhost:3001/status
```

### Paso 5: Obtener el DID del Issuer
```bash
# Listar identidades del Issuer
curl http://localhost:3001/v2/identities

# Deberías ver algo como:
# {
#   "identifier": "did:polygonid:polygon:amoy:2qQ68JkRcf3xrHPQP...",
#   "state": "confirmed",
#   ...
# }
```

---

## 📦 Opción 2: Instalación Manual (Sin Docker)

### Paso 1: Instalar PostgreSQL
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib -y

# Crear base de datos
sudo -u postgres psql
CREATE DATABASE issuer_db;
CREATE USER issuer_user WITH PASSWORD 'issuer_pass';
GRANT ALL PRIVILEGES ON DATABASE issuer_db TO issuer_user;
\q
```

### Paso 2: Instalar HashiCorp Vault
```bash
# Descargar Vault
wget https://releases.hashicorp.com/vault/1.15.0/vault_1.15.0_linux_amd64.zip
unzip vault_1.15.0_linux_amd64.zip
sudo mv vault /usr/local/bin/

# Iniciar Vault en modo dev (solo para desarrollo)
vault server -dev -dev-listen-address="0.0.0.0:8200" &
```

### Paso 3: Compilar Issuer Node desde el código
```bash
cd /home/ronaldo/Documentos/Proyects/
git clone https://github.com/0xPolygonID/issuer-node.git
cd issuer-node

# Instalar Go (si no lo tienes)
sudo apt install golang-go -y

# Compilar
make build

# Configurar .env
cp .env.sample .env
nano .env

# Ejecutar
./bin/issuer
```

---

## 🧪 Verificación del Sistema

### Test 1: Backend conectándose al Issuer Node
```bash
# Iniciar tu backend
cd /home/ronaldo/Documentos/Proyects/backend_zkp
npm run dev

# Deberías ver:
# [Config] Issuer Node URL: http://localhost:3001
# Servidor : http://localhost:5000
```

### Test 2: Crear DID desde tu backend
```bash
# Probar endpoint de registro
curl -X POST http://localhost:5000/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "test123"
  }'

# Si el Issuer Node está corriendo, verás:
# [CreateDID] ✅ DID creado en Issuer Node: did:polygonid:...
#
# Si NO está corriendo, verás:
# [CreateDID] ⚠️ Issuer Node no disponible, usando DID local
```

### Test 3: Wallet Auth
```bash
curl -X POST http://localhost:5000/api/wallet-auth \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0x1234567890123456789012345678901234567890",
    "signature": "0xabc..."
  }'
```

---

## 🔧 Solución de Problemas

### Error: "Unauthorized" (401)
```bash
# El Issuer Node requiere autenticación
# Verificar si el puerto 3001 está escuchando:
sudo netstat -tulpn | grep 3001

# Si no hay respuesta, el Issuer Node no está corriendo
docker-compose ps
```

### Error: "404 page not found"
```bash
# La ruta no existe en el Issuer Node
# Verificar la versión de la API:
curl http://localhost:3001/status

# Prueba con diferentes rutas:
curl http://localhost:3001/v1/identities  # v1
curl http://localhost:3001/v2/identities  # v2
curl http://localhost:3001/api/v1/identities
```

### Error: "Connection refused"
```bash
# El Issuer Node no está corriendo
cd /home/ronaldo/Documentos/Proyects/issuer-node
docker-compose up -d

# Esperar 30 segundos para que inicie
sleep 30

# Verificar logs
docker-compose logs issuer
```

---

## 📝 Estados del Sistema

### ✅ CON Issuer Node (Producción)
```javascript
{
  "did": "did:polygonid:polygon:amoy:2qQ68JkRcf3xrHPQP...",
  "credential": {
    "id": "urn:uuid:123e4567-e89b-12d3-a456-426614174000",
    "type": ["VerifiableCredential", "UserAuthCredential"],
    "credentialStatus": {
      "type": "SparseMerkleTreeProof"
    }
  },
  "zkpData": {
    "state": "confirmed"
  }
}
```

### ⚠️ SIN Issuer Node (Desarrollo)
```javascript
{
  "did": "did:polygonid:polygon:amoy:AhMAAAAAAAAAQnnI7HMG6ov4GNX4VvpWsRw1tVLCg",
  "credential": {
    "type": ["VerifiableCredential", "UserAuthCredential"],
    "credentialSubject": {...},
    "status": "pending_issuer",
    "message": "Credencial generada localmente. Pendiente de sincronizar con Issuer Node."
  },
  "zkpData": {
    "state": "pending_issuer"
  }
}
```

---

## 🚀 Siguiente Paso

**Para producción**, necesitas tener el Issuer Node corriendo.

**Para desarrollo/testing**, el sistema funcionará sin él usando credenciales locales.

Una vez tengas el Issuer Node corriendo:
```bash
# 1. Levantar Issuer Node
cd /home/ronaldo/Documentos/Proyects/issuer-node
docker-compose up -d

# 2. Levantar Backend
cd /home/ronaldo/Documentos/Proyects/backend_zkp
npm run dev

# 3. Levantar Frontend
cd /home/ronaldo/Documentos/Proyects/sistemazkp
npm start

# 4. Abrir navegador en localhost:3000
```

¡Listo! Ahora tu sistema ZKP funcionará con credenciales blockchain reales. 🎉
