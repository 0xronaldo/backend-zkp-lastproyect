# 📦 Cómo Usar Tu Propio Schema ZKPAuthCredential

## 🎯 Esquema Creado

**Archivo**: `ZKPAuthCredential.json`
**Tipo**: Credencial de autenticación para sistema ZKP
**Campos**:
- `fullName`: Nombre completo del usuario
- `email`: Email (opcional si usa wallet)
- `walletAddress`: Dirección wallet (opcional si usa email)
- `authMethod`: "email" o "wallet"
- `accountState`: "active", "suspended", "pending"
- `registrationDate`: Timestamp UNIX
- `isVerified`: Boolean

---

## 📤 Opción 1: Publicar en GitHub (Recomendado)

### Paso 1: Push a tu repositorio
```bash
cd /home/ronaldo/Documentos/Proyects/backend_zkp

# Agregar los nuevos schemas
git add issure-schemes/ZKPAuthCredential.json
git add issure-schemes/ZKPAuthCredential.jsonld

# Commit
git commit -m "Add ZKPAuthCredential schema"

# Push
git push origin main
```

### Paso 2: Obtener URL raw de GitHub
La URL será algo como:
```
https://raw.githubusercontent.com/0xronaldo/sistemazkp-backend/main/issure-schemes/ZKPAuthCredential.json
```

### Paso 3: Verificar que sea accesible
```bash
curl https://raw.githubusercontent.com/0xronaldo/sistemazkp-backend/main/issure-schemes/ZKPAuthCredential.json
```

---

## 📤 Opción 2: Usar GitHub Gist (Rápido)

```bash
# Instalar GitHub CLI si no lo tienes
sudo apt install gh

# Login
gh auth login

# Crear gist público
gh gist create issure-schemes/ZKPAuthCredential.json --public
gh gist create issure-schemes/ZKPAuthCredential.jsonld --public

# Copiar la URL que te da
```

---

## 📤 Opción 3: Usar IPFS (Descentralizado)

### Usando Pinata (Servicio gratuito)
1. Ir a https://pinata.cloud/
2. Crear cuenta gratis
3. Upload `ZKPAuthCredential.json`
4. Copiar el CID que te dan
5. URL será: `ipfs://Qm...` o `https://gateway.pinata.cloud/ipfs/Qm...`

### Usando IPFS local
```bash
# Instalar IPFS
sudo snap install ipfs

# Iniciar nodo
ipfs init
ipfs daemon &

# Agregar archivo
ipfs add issure-schemes/ZKPAuthCredential.json

# Te dará un CID como: QmXYZ123...
# URL: ipfs://QmXYZ123...
```

---

## 🔧 Actualizar el Backend

Una vez que tengas la URL pública, edita `backend_zkp/src/datasure.js`:

```javascript
function createCredentialRequest(did, userData) {
    return {
        credentialSchema: "https://raw.githubusercontent.com/0xronaldo/sistemazkp-backend/main/issure-schemes/ZKPAuthCredential.json",
        type: "ZKPAuthCredential",
        credentialSubject: {
            id: did,
            fullName: userData.fullName || "Unknown",
            email: userData.email || null,
            walletAddress: userData.walletAddress || null,
            authMethod: userData.authMethod,
            accountState: userData.accountState,
            registrationDate: Math.floor(Date.now() / 1000),
            isVerified: userData.isVerified || false
        },
        expiration: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 año
    };
}
```

---

## 🧪 Probar con curl

```bash
# Obtener el DID del Issuer
curl -u user-issuer:password-issuer http://localhost:3001/v2/identities

# Crear credencial con tu schema
curl -u user-issuer:password-issuer \
  -X POST "http://localhost:3001/v2/identities/did:polygonid:polygon:amoy:TU_ISSUER_DID_AQUI/credentials" \
  -H "Content-Type: application/json" \
  -d '{
    "credentialSchema": "https://raw.githubusercontent.com/0xronaldo/sistemazkp-backend/main/issure-schemes/ZKPAuthCredential.json",
    "type": "ZKPAuthCredential",
    "credentialSubject": {
      "id": "did:polygonid:polygon:amoy:TU_USER_DID_AQUI",
      "fullName": "Test User",
      "email": "test@example.com",
      "authMethod": "email",
      "accountState": "active",
      "registrationDate": 1728000000,
      "isVerified": false
    },
    "expiration": 1759536000
  }'
```

---

## ✅ Ventajas de Usar Tu Propio Schema

1. **Control Total**: Defines exactamente qué datos almacenar
2. **Personalización**: Puedes agregar campos específicos de tu app
3. **Privacidad**: No dependes de schemas públicos de terceros
4. **Flexibilidad**: Puedes actualizar el schema en el futuro (versionado)

---

## 🚀 Próximos Pasos

1. **Push a GitHub** (opción más fácil)
2. **Actualizar datasure.js** con la URL
3. **Probar el registro** desde el frontend
4. **Verificar la credencial** en el Issuer Node

¿Quieres que te ayude a hacer el push a GitHub o prefieres otra opción?
