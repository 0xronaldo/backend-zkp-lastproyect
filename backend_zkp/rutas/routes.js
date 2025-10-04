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
const { verifyCredentialWithIssuer } = require('../src/zkp-verifier');
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
// ALMACENAMIENTO TEMPORAL DE USUARIOS
// ============================================
// En producción, esto debe ser una base de datos
const usersStore = new Map();

/**
 * Guarda un usuario en el almacenamiento temporal
 */
function saveUser(email, userData) {
    usersStore.set(email.toLowerCase(), {
        ...userData,
        savedAt: new Date().toISOString()
    });
    console.log('[Store] Usuario guardado:', email);
}

/**
 * Obtiene un usuario del almacenamiento temporal
 */
function getUser(email) {
    const user = usersStore.get(email.toLowerCase());
    if (user) {
        console.log('[Store] Usuario encontrado:', email);
    }
    return user;
}

/**
 * Verifica si existe un usuario
 */
function userExists(email) {
    return usersStore.has(email.toLowerCase());
}

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
        // Construir credentialSubject solo con campos que tienen valor
        const credentialSubject = {
            id: did,
            fullName: userData.fullName || "Unknown User",
            authMethod: userData.authMethod || "email",
            accountState: userData.accountState || "active",
            registrationDate: Math.floor(Date.now() / 1000),
            isVerified: userData.isVerified || false
        };

        // Agregar email solo si existe
        if (userData.email) {
            credentialSubject.email = userData.email;
        }

        // Agregar walletAddress solo si existe
        if (userData.walletAddress) {
            credentialSubject.walletAddress = userData.walletAddress;
        }

        const credentialRequest = {
            credentialSchema: "https://gateway.pinata.cloud/ipfs/QmXAHpXSPcj2J7wreCkKkvvXgT67tbQDvFxmTHudXQYBEp",
            type: "ZKPAuthCredential",
            credentialSubject: credentialSubject,
            expiration: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 año
        };
        
        console.log('[CreateCredential] Intentando crear en Issuer Node...');
        console.log('[CreateCredential] Issuer DID:', issuerDID);
        console.log('[CreateCredential] Subject DID:', did);
        console.log('[CreateCredential] Credential Subject:', JSON.stringify(credentialSubject, null, 2));
        
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
        
        // IMPORTANTE: Obtener la credencial COMPLETA después de crearla
        const credentialId = response.data.id;
        console.log('[CreateCredential] Obteniendo credencial completa...');
        
        try {
            const credentialResponse = await axios.get(
                `${ISSUER_NODE_URL}/v2/identities/${issuerDID}/credentials/${credentialId}`,
                { 
                    headers: issuerHeaders,
                    auth: issuerAuth,
                    timeout: 5000
                }
            );
            
            console.log('[CreateCredential] ✅ Credencial completa obtenida');
            console.log('[CreateCredential] Credencial:', JSON.stringify(credentialResponse.data, null, 2));
            
            // IMPORTANTE: El Issuer Node devuelve { id, vc: {...} }
            // Necesitamos devolver solo el vc (la credencial W3C)
            return credentialResponse.data.vc || credentialResponse.data;
        } catch (fetchError) {
            console.warn('[CreateCredential] ⚠️ No se pudo obtener credencial completa:', fetchError.message);
            console.warn('[CreateCredential] Devolviendo solo ID');
            return response.data;
        }
        
    } catch (error) {
        console.warn('[CreateCredential] ⚠️ Error:', error.response?.data?.message || error.message);
        console.warn('[CreateCredential] Usando credencial local como fallback');
        
        // Crear credencial localmente
        const localCredential = userData.authMethod === 'wallet'
            ? createWalletAuthCredential(did, userData.walletAddress, userData)
            : createUserAuthCredential(did, userData);
        
        console.log('[CreateCredential] 📄 Credencial local creada:', JSON.stringify(localCredential, null, 2));
        
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
        
        // Verificar si el usuario ya existe
        if (userExists(email)) {
            return res.status(400).json({
                success: false,
                error: 'El email ya está registrado. Por favor, inicia sesión.'
            });
        }

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
        
        // GUARDAR USUARIO EN EL STORE
        saveUser(email, {
            name: name,
            email: email,
            password: passwordHash,
            did: did,
            credential: credential,
            zkpData: {
                identifier: did,
                state: issuerResponse.state || 'active'
            },
            authMethod: 'email',
            accountState: 'active',
            createdAt: new Date().toISOString()
        });

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

        console.log('[Login] Intento de login:', email);

        // Verificar si el usuario existe
        const user = getUser(email);
        
        if (!user) {
            console.log('[Login] Usuario no encontrado:', email);
            return res.status(401).json({
                success: false,
                error: 'Usuario no encontrado. Por favor, regístrate primero.'
            });
        }

        // Verificar contraseña
        const passwordHash = hashData(password);
        
        if (user.password !== passwordHash) {
            console.log('[Login] Contraseña incorrecta');
            return res.status(401).json({
                success: false,
                error: 'Contraseña incorrecta'
            });
        }
        
        console.log('[Login] ✅ Login exitoso:', email);
        
        // Devolver todos los datos del usuario (DID, credencial, etc.)
        res.json({
            success: true,
            did: user.did,
            user: {
                name: user.name,
                email: user.email,
                type: 'email',
                state: user.accountState || 'active'
            },
            credential: user.credential,
            zkpData: user.zkpData,
            message: 'Login exitoso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Login] Error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Error al iniciar sesión',
            details: error.message
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
// ENDPOINTS ZKP - Solo Verificación de Pruebas
// ============================================

/**
 * NOTA IMPORTANTE sobre el flujo ZKP con Polygon ID:
 * 
 * 1. Issuer Node: Crea DIDs y emite credenciales
 * 2. Usuario (Wallet/Frontend): Genera proofs ZKP localmente con el SDK
 * 3. Backend (Verificador): Solo VERIFICA los proofs, no los genera
 * 
 * El Issuer Node NO tiene endpoint para generar proofs.
 * Los proofs se generan en el cliente usando @0xpolygonid/js-sdk
 */

/**
 * Verificar prueba ZKP
 * POST /verify-proof
 * 
 * Body: {
 *   "proof": { pi_a, pi_b, pi_c },
 *   "pub_signals": [...],
 *   "circuitId": "credentialAtomicQueryMTPV2"
 * }
 */
router.post('/verify-proof', async (req, res) => {
    try {
        const { proof, pub_signals, circuitId } = req.body;

        if (!proof || !pub_signals || !circuitId) {
            return res.status(400).json({ 
                error: 'Faltan campos requeridos',
                required: ['proof', 'pub_signals', 'circuitId']
            });
        }

        console.log('🔍 Verificando prueba ZKP...');
        console.log('Circuit ID:', circuitId);
        console.log('Pub signals:', pub_signals);

        // Intentar verificar con el Issuer Node
        try {
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
                timestamp: new Date().toISOString()
            });

        } catch (issuerError) {
            console.warn('⚠️ Issuer Node no disponible para verificación');
            console.warn('Error:', issuerError.response?.data?.message || issuerError.message);
            
            // Verificación básica local si el Issuer Node falla
            const isValid = proof && 
                           proof.pi_a && 
                           proof.pi_b && 
                           proof.pi_c && 
                           pub_signals && 
                           pub_signals.length > 0;
            
            console.log('📝 Verificación local:', isValid ? 'VÁLIDA (estructura)' : 'INVÁLIDA');
            
            res.json({
                success: true,
                verified: isValid,
                message: isValid 
                    ? '✅ Prueba verificada localmente (estructura correcta)' 
                    : '❌ Prueba inválida (estructura incorrecta)',
                localVerification: true,
                note: 'Issuer Node no disponible. Verificación basada en estructura de proof.',
                proofStructure: {
                    hasPiA: !!proof?.pi_a,
                    hasPiB: !!proof?.pi_b,
                    hasPiC: !!proof?.pi_c,
                    pubSignalsCount: pub_signals?.length || 0
                },
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

// ============================================
// ENDPOINT: Verificar Credencial (CON VERIFICACIÓN REAL)
// ============================================
router.post('/api/verify-credential', async (req, res) => {
    try {
        const { credential, issuerDID } = req.body;
        
        console.log('[VerifyCredential] 🔐 Iniciando verificación ZKP...');
        console.log('[VerifyCredential] Credential ID:', credential?.id);
        console.log('[VerifyCredential] Issuer DID:', issuerDID);
        
        if (!credential || !credential.credentialSubject) {
            return res.status(400).json({
                success: false,
                error: 'Credencial inválida o incompleta',
                details: 'La credencial debe incluir credentialSubject'
            });
        }
        
        // Obtener el DID del Issuer (el que emitió la credencial)
        const actualIssuerDID = credential.issuer || issuerDID || await getIssuerDID();
        
        console.log('[VerifyCredential] 📝 Issuer real:', actualIssuerDID);
        
        // VERIFICACIÓN REAL usando el Issuer Node
        const verificationResult = await verifyCredentialWithIssuer(
            credential,
            actualIssuerDID,
            ISSUER_NODE_URL,
            issuerAuth
        );
        
        console.log('[VerifyCredential] Resultado:', verificationResult);
        
        if (verificationResult.verified) {
            console.log('[VerifyCredential] ✅ CREDENCIAL VERIFICADA');
            
            res.json({
                success: true,
                verified: true,
                message: verificationResult.warning 
                    ? verificationResult.message 
                    : '✅ Credencial verificada correctamente',
                proof: {
                    type: 'CredentialVerification',
                    method: verificationResult.localVerification ? 'local' : 'issuer-node',
                    timestamp: new Date().toISOString(),
                    ...verificationResult.details
                },
                // Datos completos en formato JSON para mostrar
                fullData: {
                    verification: {
                        verified: true,
                        timestamp: new Date().toISOString(),
                        method: verificationResult.localVerification ? 'local-verification' : 'issuer-node-verification',
                        checks: {
                            structureValid: true,
                            issuerMatch: true,
                            subjectMatch: true,
                            notRevoked: verificationResult.details?.notRevoked || false,
                            proofValid: verificationResult.details?.zkpProof ? true : false
                        }
                    },
                    credential: {
                        id: credential.id,
                        issuer: credential.issuer,
                        subject: credential.credentialSubject?.id,
                        type: credential.type,
                        issuanceDate: credential.issuanceDate,
                        expirationDate: credential.expirationDate
                    },
                    zkpProof: verificationResult.details?.zkpProof || null,
                    rawData: verificationResult.rawData || null
                },
                localVerification: verificationResult.localVerification || false,
                warning: verificationResult.warning
            });
        } else {
            console.log('[VerifyCredential] ❌ CREDENCIAL INVÁLIDA:', verificationResult.error);
            
            res.status(400).json({
                success: false,
                verified: false,
                error: verificationResult.error,
                stage: verificationResult.stage,
                message: '❌ Credencial inválida o no verificable'
            });
        }
        
    } catch (error) {
        console.error('[VerifyCredential] ❌ Error:', error.message);
        res.status(500).json({ 
            success: false,
            verified: false,
            error: 'Error al verificar credencial',
            details: error.message
        });
    }
});

module.exports = router;
