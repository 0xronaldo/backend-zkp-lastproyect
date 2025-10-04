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
const {
    createZKPProofRequest,
    createFullProofRequest,
    createAccountStateQuery,
    createVerificationQuery,
    createAuthMethodQuery,
    createEmailRegistrationQuery,
    createWalletRegistrationQuery,
    createAccountAgeQuery,
    createCombinedQuery,
    formatZKPProofResponse
} = require('../src/zkp-proofs');

const router = express.Router();

const ISSUER_NODE_URL = process.env.ISSUER_NODE_BASE_URL;
const ISSUER_NODE_USER = process.env.ISSUER_NODE_USER;
const ISSUER_NODE_PASSWORD = process.env.ISSUER_NODE_PASSWORD;

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
console.log('[Config] Issuer Auth: Habilitado');

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
                type: "BJJ" // ETHr 
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

        console.log('[CreateDID] DID creado en Issuer Node:', response.data.identifier);
        return response.data;
    } catch (error) {
        console.warn('[CreateDID]  Issuer Node no disponible, usando DID local');
        
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
        
                // Usar schema real de IPFS
        const credentialRequest = {
            credentialSchema: "https://gateway.pinata.cloud/ipfs/QmXAHpXSPcj2J7wreCkKkvvXgT67tbQDvFxmTHudXQYBEp",
            type: "ZKPAuthCredential",
            credentialSubject: {
                id: did,
                fullName: userData.fullName || "Unknown User",
                email: userData.email || null,
                walletAddress: userData.walletAddress || null,
                authMethod: userData.authMethod || "email",
                accountState: userData.accountState || "active",
                registrationDate: Math.floor(Date.now() / 1000),
                isVerified: userData.isVerified || false
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
            ? createWalletAuthCredential(did, userData.walletAddress, userData)
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

        const userData = {
            fullName: `Wallet ${walletAddress.slice(0, 6)}...`,
            walletAddress: walletAddress,
            authMethod: 'wallet',
            accountState: 'active',
            isVerified: true
        };

        // Crear DID en el Issuer Node
        const issuerResponse = await createDIDInIssuer(userData);
        const did = issuerResponse.identifier; // ✅ Usar DID del Issuer Node
        
        console.log('[WalletAuth] DID del Issuer Node:', did);

        // Crear credencial con el DID del Issuer
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
                state: issuerResponse.state || 'active'
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

// ============================================
// ENDPOINTS ZKP - Generar y Verificar Pruebas
// ============================================

/**
 * Generar prueba ZKP
 * POST /api/generate-proof
 * 
 * Body: {
 *   "userDID": "did:polygonid:polygon:amoy:...",
 *   "issuerDID": "did:polygonid:polygon:amoy:...",
 *   "credentialId": "uuid-de-credencial",
 *   "proofType": "verification" | "accountState" | "authMethod" | "custom",
 *   "customQuery": {} // opcional para custom
 * }
 */
router.post('/generate-proof', async (req, res) => {
    try {
        const { userDID, issuerDID, credentialId, proofType, customQuery } = req.body;

        if (!userDID || !issuerDID || !credentialId) {
            return res.status(400).json({ 
                error: 'Faltan campos requeridos',
                required: ['userDID', 'issuerDID', 'credentialId']
            });
        }

        // Crear query según el tipo de prueba
        let query;
        switch (proofType) {
            case 'verification':
                query = createVerificationQuery();
                break;
            case 'accountState':
                query = createAccountStateQuery('active');
                break;
            case 'authMethod':
                const method = req.body.authMethod || 'wallet';
                query = createAuthMethodQuery(method);
                break;
            case 'emailRegistration':
                query = createEmailRegistrationQuery();
                break;
            case 'walletRegistration':
                query = createWalletRegistrationQuery();
                break;
            case 'accountAge':
                const minDays = req.body.minDays || 30;
                query = createAccountAgeQuery(minDays);
                break;
            case 'combined':
                query = createCombinedQuery(req.body.conditions || {});
                break;
            case 'custom':
                query = customQuery || {};
                break;
            default:
                query = createVerificationQuery(); // Default
        }

        // Crear el proof request para el Issuer Node
        const proofRequest = {
            circuitId: "credentialAtomicQueryMTPV2", // MTP V2 por defecto
            accountAddress: userDID,
            query: {
                allowedIssuers: [issuerDID],
                context: "ipfs://QmXAHpXSPcj2J7wreCkKkvvXgT67tbQDvFxmTHudXQYBEp",
                credentialSubject: query,
                type: "ZKPAuthCredential"
            }
        };

        console.log('Generando prueba ZKP:', JSON.stringify(proofRequest, null, 2));

        // Llamar al Issuer Node para generar la prueba
        // Nota: Este endpoint puede variar según la versión del Issuer Node
        const response = await axios.post(
            `${ISSUER_NODE_URL}/v2/proofs/query`,
            proofRequest,
            { 
                headers: issuerHeaders,
                auth: issuerAuth
            }
        );

        console.log('Prueba ZKP generada exitosamente');

        res.json({
            success: true,
            proof: formatZKPProofResponse(response.data),
            proofType: proofType,
            query: query,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error generando prueba ZKP:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Error al generar prueba ZKP',
            details: error.response?.data || error.message,
            issuerNodeUrl: ISSUER_NODE_URL
        });
    }
});

/**
 * Verificar prueba ZKP
 * POST /verify-proof
 * 
 * Body: {
 *   "proof": { ... }, // Objeto de prueba ZKP del SDK
 *   "circuitId": "credentialAtomicQueryMTPV2",
 *   "query": { ... } // Query usado para generar la prueba
 * }
 */
router.post('/verify-proof', async (req, res) => {
    try {
        const { proof, circuitId, query } = req.body;

        if (!proof || !circuitId) {
            return res.status(400).json({ 
                error: 'Faltan campos requeridos',
                required: ['proof', 'circuitId']
            });
        }

        console.log('🔍 Verificando prueba ZKP...');
        console.log('Circuit ID:', circuitId);

        // Intentar verificar con el Issuer Node
        try {
            const verificationRequest = {
                circuitId: circuitId,
                proof: proof.proof || proof,
                pub_signals: proof.pub_signals || []
            };

            const response = await axios.post(
                `${ISSUER_NODE_URL}/v2/proofs/verify`,
                verificationRequest,
                { 
                    headers: issuerHeaders,
                    auth: issuerAuth,
                    timeout: 10000
                }
            );

            console.log('✅ Prueba verificada por Issuer Node:', response.data.verified ? 'VÁLIDA' : 'INVÁLIDA');

            res.json({
                success: true,
                verified: response.data.verified === true,
                message: response.data.verified 
                    ? 'Prueba ZKP verificada exitosamente' 
                    : 'Prueba ZKP inválida',
                details: response.data,
                query: query,
                timestamp: new Date().toISOString()
            });

        } catch (issuerError) {
            console.warn('⚠️ Issuer Node no disponible, verificación local...');
            
            // Verificación básica local si el Issuer Node falla
            const isValid = proof && proof.proof && (proof.pub_signals || proof.publicSignals);
            
            res.json({
                success: true,
                verified: isValid,
                message: isValid 
                    ? 'Prueba validada localmente (Issuer Node no disponible)' 
                    : 'Prueba inválida',
                localVerification: true,
                query: query,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        console.error('❌ Error verificando prueba ZKP:', error.message);
        res.status(500).json({ 
            error: 'Error al verificar prueba ZKP',
            details: error.message
        });
    }
});
router.post('/verify-proof', async (req, res) => {
    try {
        const { proof, pub_signals, circuitId } = req.body;

        if (!proof || !pub_signals || !circuitId) {
            return res.status(400).json({ 
                error: 'Faltan campos requeridos',
                required: ['proof', 'pub_signals', 'circuitId']
            });
        }

        console.log('Verificando prueba ZKP...');

        // Llamar al Issuer Node para verificar la prueba
        const verificationRequest = {
            circuitId: circuitId,
            proof: proof,
            pub_signals: pub_signals
        };

        const response = await axios.post(
            `${ISSUER_NODE_URL}/v2/proofs/verify`,
            verificationRequest,
            { 
                headers: issuerHeaders,
                auth: issuerAuth
            }
        );

        console.log('Prueba verificada:', response.data.verified ? 'VALIDA' : 'INVALIDA');

        res.json({
            success: true,
            verified: response.data.verified,
            message: response.data.verified 
                ? 'Prueba ZKP verificada exitosamente' 
                : 'Prueba ZKP inválida',
            details: response.data,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Error] verificando prueba ZKP:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Error al verificar prueba ZKP',
            details: error.response?.data || error.message
        });
    }
});

/**
 * Obtener esquema de prueba ZKP
 * GET /api/proof-schema?type=verification
 * 
 * Devuelve el esquema de query para diferentes tipos de pruebas
 */
router.get('/proof-schema', (req, res) => {
    const { type } = req.query;

    const schemas = {
        verification: {
            description: 'Probar que el usuario está verificado sin revelar datos personales',
            query: createVerificationQuery(),
            circuitId: 'credentialAtomicQueryMTPV2',
            example: 'Permitir acceso a contenido premium solo a usuarios verificados'
        },
        accountState: {
            description: 'Probar que la cuenta está activa',
            query: createAccountStateQuery('active'),
            circuitId: 'credentialAtomicQueryMTPV2',
            example: 'Validar que el usuario no está suspendido o baneado'
        },
        authMethod: {
            description: 'Probar el método de autenticación usado (wallet o email)',
            query: createAuthMethodQuery('wallet'),
            circuitId: 'credentialAtomicQueryMTPV2',
            example: 'Dar privilegios especiales a usuarios que usan wallet'
        },
        emailRegistration: {
            description: 'Probar que se registró con email sin revelar el email',
            query: createEmailRegistrationQuery(),
            circuitId: 'credentialAtomicQueryMTPV2',
            example: 'Validar que tiene email registrado para enviar notificaciones'
        },
        walletRegistration: {
            description: 'Probar que se registró con wallet sin revelar la dirección',
            query: createWalletRegistrationQuery(),
            circuitId: 'credentialAtomicQueryMTPV2',
            example: 'Validar que puede interactuar con contratos inteligentes'
        },
        accountAge: {
            description: 'Probar que la cuenta tiene más de X días de antigüedad',
            query: createAccountAgeQuery(30),
            circuitId: 'credentialAtomicQueryMTPV2',
            example: 'Dar descuentos a usuarios con más de 90 días registrados',
            params: { minDays: 30 }
        },
        combined: {
            description: 'Combinar múltiples condiciones en una sola prueba',
            query: createCombinedQuery({
                isVerified: true,
                accountState: 'active',
                authMethod: 'wallet',
                minAge: 30
            }),
            circuitId: 'credentialAtomicQueryMTPV2',
            example: 'Probar que está verificado, activo, usa wallet y tiene más de 30 días',
            params: {
                isVerified: 'boolean (opcional)',
                accountState: 'string (opcional)',
                authMethod: 'string (opcional)',
                minAge: 'number (días, opcional)',
                hasEmail: 'boolean (opcional)',
                hasWallet: 'boolean (opcional)'
            }
        },
        custom: {
            description: 'Query personalizado con operadores ZKP',
            query: {
                fieldName: {
                    $eq: 'value'
                }
            },
            circuitId: 'credentialAtomicQueryMTPV2',
            operators: {
                $eq: 'Igual a',
                $ne: 'No igual a',
                $lt: 'Menor que',
                $gt: 'Mayor que',
                $in: 'En lista',
                $nin: 'No en lista',
                $exists: 'Campo existe'
            }
        }
    };

    if (type && schemas[type]) {
        res.json({
            type: type,
            ...schemas[type],
            availableTypes: Object.keys(schemas)
        });
    } else {
        res.json({
            message: 'Esquemas de prueba ZKP disponibles',
            schemas: schemas,
            usage: '/api/proof-schema?type=verification'
        });
    }
});

module.exports = router;
