const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const { 
    userToIdentitySchema, 
    walletToIdentitySchema,
    createUserAuthCredential,
    createWalletAuthCredential,
    didFromEthAddress
} = require('../scheme/scheme');

const { validateUserData, createCredentialRequest } = require('../src/datasure');
const { validateDID, validateEmail, hashData } = require('../src/validador');

const router = express.Router();

const ISSUER_NODE_URL = process.env.ISSUER_NODE_BASE_URL || 'http://localhost:3001';
const ISSUER_NODE_USER = process.env.ISSUER_NODE_USER || 'user-issuer';
const ISSUER_NODE_PASSWORD = process.env.ISSUER_NODE_PASSWORD || 'password-issuer';

// Configuración para axios con Basic Auth
const issuerAuth = {
    username: ISSUER_NODE_USER,
    password: ISSUER_NODE_PASSWORD
};

const issuerHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
};

console.log('[Config] Issuer Node URL:', ISSUER_NODE_URL);
console.log('[Config] Issuer Auth: ✅ Enabled');

// ============================================
// HELPER: Obtener DID del Issuer
// ============================================
let ISSUER_DID = null;

async function getIssuerDID() {
    if (ISSUER_DID) return ISSUER_DID;
    
    try {
        const response = await axios.get(
            `${ISSUER_NODE_URL}/v2/identities`,
            { 
                headers: issuerHeaders,
                auth: issuerAuth
            }
        );
        
        if (response.data && response.data.length > 0) {
            ISSUER_DID = response.data[0].identifier;
            console.log('[Config] Issuer DID obtenido:', ISSUER_DID);
            return ISSUER_DID;
        }
    } catch (error) {
        console.error('[Config] No se pudo obtener Issuer DID:', error.message);
    }
    
    return null;
}

// Obtener el DID del Issuer al iniciar
getIssuerDID();

// ============================================
// HELPER: Crear DID en Issuer Node
// ============================================
async function createDIDInIssuer(userData = {}) {
    try {
        const identityRequest = {
            didMetadata: {
                method: "polygonid",
                blockchain: "polygon",
                network: "amoy",
                type: "BJJ"
            }
        };
        
        console.log('[CreateDID] Intentando conectar a Issuer Node...');
        
        const response = await axios.post(
            `${ISSUER_NODE_URL}/v2/identities`,
            identityRequest,
            { 
                headers: issuerHeaders,
                auth: issuerAuth,
                timeout: 5000
            }
        );

        console.log('[CreateDID] ✅ DID creado en Issuer Node:', response.data.identifier);
        return response.data;
    } catch (error) {
        console.warn('[CreateDID] ⚠️ Issuer Node no disponible, usando DID local');
        
        // Generar DID localmente si el Issuer Node no está disponible
        const localDID = userData.walletAddress 
            ? didFromEthAddress(userData.walletAddress, 'amoy')
            : `did:polygonid:polygon:amoy:${hashData(userData.email || Date.now().toString()).slice(0, 40)}`;
        
        return {
            identifier: localDID,
            state: 'pending_issuer',
            message: 'DID generado localmente. Issuer Node no disponible.'
        };
    }
}

// ============================================
// HELPER: Crear Credencial en Issuer Node
// ============================================
async function createCredentialInIssuer(did, userData) {
    try {
        const issuerDID = await getIssuerDID();
        
        if (!issuerDID) {
            throw new Error('No se pudo obtener el DID del Issuer');
        }
        
        // Usar schema simple de KYCAgeCredential que es nativo del Issuer Node
        const credentialRequest = {
            credentialSchema: "https://raw.githubusercontent.com/iden3/claim-schema-vocab/main/schemas/json/KYCAgeCredential-v3.json",
            type: "KYCAgeCredential",
            credentialSubject: {
                id: did,
                birthday: 19960424,
                documentType: 99
            },
            expiration: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 año
        };
        
        console.log('[CreateCredential] Intentando crear en Issuer Node...');
        console.log('[CreateCredential] Issuer DID:', issuerDID);
        console.log('[CreateCredential] Subject DID:', did);
        
        const response = await axios.post(
            `${ISSUER_NODE_URL}/v2/identities/${issuerDID}/credentials`,
            credentialRequest,
            { 
                headers: issuerHeaders,
                auth: issuerAuth,
                timeout: 5000
            }
        );

        console.log('[CreateCredential] ✅ Credencial creada en Issuer Node:', response.data.id);
        return response.data;
    } catch (error) {
        console.warn('[CreateCredential] ⚠️ Error:', error.response?.data?.message || error.message);
        console.warn('[CreateCredential] Usando credencial local');
        
        // Crear credencial localmente
        const localCredential = userData.authMethod === 'wallet'
            ? createWalletAuthCredential(did, userData)
            : createUserAuthCredential(did, userData);
        
        return {
            ...localCredential,
            status: 'pending_issuer',
            message: 'Credencial generada localmente. Pendiente de sincronizar con Issuer Node.'
        };
    }
}

// ============================================
// ENDPOINT: Registro
// ============================================
router.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Faltan datos requeridos' 
            });
        }

        console.log('[Register] Registrando:', email);

        const userData = {
            fullName: name,
            email: email,
            authMethod: 'email',
            accountState: 'active',
            isVerified: false
        };

        const validation = validateUserData(userData);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                error: 'Datos inválidos',
                details: validation.errors
            });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Email inválido'
            });
        }

        const issuerResponse = await createDIDInIssuer(userData);
        const did = issuerResponse.identifier;

        const credential = await createCredentialInIssuer(did, userData);

        const passwordHash = hashData(password);
        console.log('[Register] Password hasheado');

        res.json({
            success: true,
            did: did,
            user: {
                name: name,
                email: email,
                type: 'email',
                state: 'active'
            },
            credential: credential,
            zkpData: {
                identifier: did,
                state: issuerResponse.state || 'active'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Register] Error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Error al crear cuenta',
            details: error.message 
        });
    }
});

// ============================================
// ENDPOINT: Wallet Auth
// ============================================
router.post('/api/wallet-auth', async (req, res) => {
    try {
        const { walletAddress } = req.body;
        
        if (!walletAddress) {
            return res.status(400).json({ 
                success: false, 
                error: 'Falta wallet address' 
            });
        }

        console.log('[WalletAuth] Autenticando:', walletAddress);

        const did = didFromEthAddress(walletAddress, 'testnet');
        console.log('[WalletAuth] DID generado:', did);

        const userData = {
            fullName: `Wallet ${walletAddress.slice(0, 6)}...`,
            walletAddress: walletAddress,
            authMethod: 'wallet',
            accountState: 'active',
            isVerified: true
        };

        let issuerResponse;
        try {
            issuerResponse = await createDIDInIssuer(userData);
        } catch (error) {
            issuerResponse = { identifier: did, state: 'active' };
        }

        const credential = await createCredentialInIssuer(did, userData);

        res.json({
            success: true,
            did: did,
            user: {
                name: userData.fullName,
                walletAddress: walletAddress,
                type: 'wallet',
                state: 'active'
            },
            credential: credential,
            zkpData: {
                identifier: did,
                state: 'active'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[WalletAuth] Error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Error en autenticación',
            details: error.message 
        });
    }
});

// ============================================
// ENDPOINT: Login
// ============================================
router.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Faltan credenciales' 
            });
        }

        console.log('[Login] Intento:', email);

        const passwordHash = hashData(password);
        
        res.json({
            success: true,
            did: 'did:polygonid:polygon:amoy:2qExample',
            user: {
                name: email.split('@')[0],
                email: email,
                type: 'email',
                state: 'active'
            },
            message: 'Login OK (implementar BD)'
        });

    } catch (error) {
        console.error('[Login] Error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Error al iniciar sesión'
        });
    }
});

// ============================================
// INFO del Issuer
// ============================================
router.get('/api/issuer/info', async (req, res) => {
    try {
        const response = await axios.get(
            `${ISSUER_NODE_URL}/v2/identities`,
            { 
                headers: issuerHeaders,
                auth: issuerAuth
            }
        );

        res.json({
            success: true,
            issuerUrl: ISSUER_NODE_URL,
            identities: response.data,
            message: 'Issuer Node conectado'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'No se pudo conectar con Issuer Node',
            issuerUrl: ISSUER_NODE_URL,
            details: error.message
        });
    }
});

// ============================================
// Passthrough
// ============================================
router.post('/v2/identities', async (req, res) => {
    try {
        const response = await axios.post(
            `${ISSUER_NODE_URL}/v2/identities`,
            req.body,
            { 
                headers: issuerHeaders,
                auth: issuerAuth
            }
        );
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ 
            error: 'Error al crear DID',
            details: error.response?.data || error.message 
        });
    }
});

router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        issuerNode: ISSUER_NODE_URL,
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
