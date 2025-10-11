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
// HELPER: Extraer zkpData del proof de la credencial
// ============================================
function extractZkpDataFromCredential(credential, did) {
    try {
        if (!credential || !credential.proof || !Array.isArray(credential.proof) || credential.proof.length === 0) {
            console.log('[ExtractZkpData] ⚠️ Credencial sin proof, retornando datos básicos');
            return {
                identifier: did,
                state: 'no-proof',
                proofType: null
            };
        }

        const proof = credential.proof[0]; // Primer proof (BJJSignature2021)
        
        const zkpData = {
            identifier: did,
            state: 'verified',
            proofType: proof.type || 'BJJSignature2021',
            // Core claim (claim codificada en ZKP)
            coreClaim: proof.coreClaim || null,
            // Firma ZKP
            signature: proof.signature || null,
            // Datos del issuer (Merkle tree)
            issuerData: proof.issuerData ? {
                id: proof.issuerData.id,
                state: proof.issuerData.state ? {
                    value: proof.issuerData.state.value,
                    claimsTreeRoot: proof.issuerData.state.claimsTreeRoot
                } : null,
                authCoreClaim: proof.issuerData.authCoreClaim || null,
                mtp: proof.issuerData.mtp ? {
                    existence: proof.issuerData.mtp.existence,
                    siblings: proof.issuerData.mtp.siblings || []
                } : null,
                credentialStatus: proof.issuerData.credentialStatus || null
            } : null
        };

        console.log('[ExtractZkpData] ✅ ZKP Data extraído:', {
            proofType: zkpData.proofType,
            hasCoreClaim: !!zkpData.coreClaim,
            hasSignature: !!zkpData.signature,
            hasIssuerData: !!zkpData.issuerData
        });

        return zkpData;
    } catch (error) {
        console.error('[ExtractZkpData] ❌ Error extrayendo zkpData:', error.message);
        return {
            identifier: did,
            state: 'error',
            error: error.message
        };
    }
}

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
                timeout: 15000 // 15 segundos para crear DID
            }
        );

        console.log('[CreateDID] DID creado en Issuer Node:', response.data.identifier);
        return response.data;
    } catch (error) {
        console.error('[CreateDID] ❌ ERROR al crear DID en Issuer Node:', error.message);
        console.error('[CreateDID] ❌ Código:', error.code);
        console.error('[CreateDID] ❌ Es timeout?:', error.code === 'ECONNABORTED');
        console.error('[CreateDID] ❌ Response status:', error.response?.status);
        console.error('[CreateDID] ❌ Response data:', error.response?.data);
        
        // Mensaje detallado sobre por qué falló
        let errorDetail = '';
        if (error.code === 'ECONNABORTED') {
            errorDetail = 'Tiempo de espera agotado. El Issuer Node está tardando demasiado en responder.';
        } else if (error.code === 'ECONNREFUSED') {
            errorDetail = 'El Issuer Node no está en ejecución o no es accesible en ' + ISSUER_NODE_URL;
        } else if (error.response?.status === 401) {
            errorDetail = 'Credenciales de autenticación inválidas para el Issuer Node.';
        } else if (error.response?.status === 500) {
            errorDetail = 'El Issuer Node encontró un error interno al procesar la solicitud.';
        } else {
            errorDetail = error.message;
        }
        
        throw new Error(`No se pudo crear el DID (Identidad Descentralizada). ${errorDetail}. Sin un DID válido del Issuer Node no es posible crear credenciales ZKP con firma criptográfica real. Contacta al administrador del sistema.`);
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
            credentialSchema: "ipfs://QmXAHpXSPcj2J7wreCkKkvvXgT67tbQDvFxmTHudXQYBEp",
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
                timeout: 15000 // 15 segundos - crear credencial puede tardar
            }
        );

        console.log('[CreateCredential] ✅ Credencial creada en Issuer Node:', response.data.id);
        
        // IMPORTANTE: Publicar el estado para generar el proof criptográfico
        const credentialId = response.data.id;
        console.log('[CreateCredential] Publicando estado para generar proof...');
        console.log('[CreateCredential] ⏳ Esto puede tardar hasta 30 segundos...');
        
        try {
            // Publicar el estado del Issuer (esto genera el proof en la blockchain)
            const publishResponse = await axios.post(
                `${ISSUER_NODE_URL}/v2/identities/${issuerDID}/state/publish`,
                {},
                { 
                    headers: issuerHeaders,
                    auth: issuerAuth,
                    timeout: 30000 // 30 segundos - publicar en blockchain puede tardar
                }
            );
            
            console.log('[CreateCredential] ✅ Estado publicado:', publishResponse.data);
            console.log('[CreateCredential] 🕗 Esperando 3 segundos para que se procese...');
            
            // Esperar un momento para que se procese
            await new Promise(resolve => setTimeout(resolve, 3000));
            
        } catch (publishError) {
            console.error('[CreateCredential]  Error publicando estado:', publishError.message);
            console.error('[CreateCredential]  Timeout?:', publishError.code === 'ECONNABORTED');
            console.error('[CreateCredential]  Response:', publishError.response?.data);
            console.warn('[CreateCredential]   La credencial se creó pero NO se publicó el estado');
            console.warn('[CreateCredential]  Esto significa que NO tendrá proof criptográfico');
        }
        
        // Obtener la credencial COMPLETA después de publicar
        console.log('[CreateCredential] Obteniendo credencial completa con proof...');
        
        try {
            const credentialResponse = await axios.get(
                `${ISSUER_NODE_URL}/v2/identities/${issuerDID}/credentials/${credentialId}`,
                { 
                    headers: issuerHeaders,
                    auth: issuerAuth,
                    timeout: 10000 // 10 segundos para obtener
                }
            );
            
            console.log('[CreateCredential] ✅ Credencial completa obtenida');
            console.log('[CreateCredential] Tiene proof:', !!credentialResponse.data.proofTypes);
            
            // IMPORTANTE: El Issuer Node devuelve diferentes estructuras
            // Puede ser: { id, vc: {...} } o directamente la credencial
            const credential = credentialResponse.data.vc || credentialResponse.data;
            
            // Verificar que tenga proof
            if (!credential.proof && !credential.proofTypes) {
                console.warn('[CreateCredential] ⚠️ La credencial no tiene proof todavía');
            }
            
            return credential;
        } catch (fetchError) {
            console.warn('[CreateCredential] ⚠️ No se pudo obtener credencial completa:', fetchError.message);
            console.warn('[CreateCredential] Devolviendo solo ID');
            return response.data;
        }
        
    } catch (error) {
        console.error('[CreateCredential]  ERROR CRÍTICO:', error.message);
        console.error('[CreateCredential]  Código de error:', error.code);
        console.error('[CreateCredential]  Es timeout?:', error.code === 'ECONNABORTED');
        console.error('[CreateCredential]  Response status:', error.response?.status);
        console.error('[CreateCredential]  Response data:', JSON.stringify(error.response?.data, null, 2));
        
        // Mensaje específico según el tipo de error
        let errorMessage = 'No se pudo crear la credencial ZKP. ';
        
        if (error.code === 'ECONNABORTED') {
            errorMessage += 'Tiempo de espera agotado (timeout). ';
            errorMessage += 'El Issuer Node está tardando más de lo esperado en responder. ';
            throw new Error(errorMessage + 'El servidor puede estar sobrecargado o procesando muchas solicitudes. Inténtalo nuevamente en unos momentos. Si el problema persiste, contacta al administrador.');
        } else if (error.code === 'ECONNREFUSED' || error.message.includes('connect')) {
            errorMessage += 'El Issuer Node no está disponible o no responde.';
            throw new Error(errorMessage + ' El servidor de emisión de credenciales está fuera de línea. Por favor, contacta al administrador del sistema.');
        } else if (error.response?.status === 401 || error.response?.status === 403) {
            errorMessage += 'Error de autenticación con el Issuer Node.';
            throw new Error(errorMessage + ' Las credenciales de acceso al servidor de emisión son inválidas. Contacta al administrador.');
        } else if (error.response?.status === 400) {
            errorMessage += 'Los datos proporcionados son inválidos.';
            throw new Error(errorMessage + ' ' + (error.response?.data?.message || 'Verifica que todos los campos sean correctos.'));
        } else if (error.response?.status === 500) {
            errorMessage += 'Error interno del Issuer Node.';
            throw new Error(errorMessage + ' El servidor de emisión encontró un error al procesar la solicitud.');
        } else {
            throw new Error(errorMessage + error.message + ' No se puede generar una credencial con firma criptográfica real sin el Issuer Node.');
        }
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
        
        // VERIFICACIÓN ZKP AUTOMÁTICA después del registro
        let zkpVerification = null;
        console.log('[Register] Iniciando verificación ZKP automática post-registro...');
        try {
            zkpVerification = await verifyCredentialWithIssuer(
                credential,
                did,
                ISSUER_NODE_URL,
                issuerAuth
            );
            console.log('[Register] Verificación ZKP completada:', zkpVerification.verified ? 'VÁLIDA ✓' : 'INVÁLIDA ✗');
        } catch (error) {
            console.error('[Register] Error en verificación ZKP automática:', error.message);
            zkpVerification = { verified: false, error: error.message };
        }
        
        // Extraer zkpData del proof de la credencial
        const zkpData = extractZkpDataFromCredential(credential, did);
        
        // GUARDAR USUARIO EN EL STORE con verificación ZKP
        saveUser(email, {
            name: name,
            email: email,
            password: passwordHash,
            did: did,
            credential: credential,
            zkpData: zkpData,
            authMethod: 'email',
            accountState: 'active',
            createdAt: new Date().toISOString(),
            zkpVerified: zkpVerification?.verified || false,
            zkpVerificationDate: new Date().toISOString()
        });

        // Respuesta con estructura completa igual que wallet-auth
        res.json({
            success: true,
            message: 'Usuario registrado exitosamente',
            did: did,
            credential: credential, // Credencial completa W3C
            zkpData: zkpData,
            user: {
                name: name,
                email: email,
                did: did,
                type: 'email',
                state: 'active',
                authMethod: 'email',
                // Agregar resultado de verificación ZKP automática
                zkpVerified: zkpVerification?.verified || false,
                zkpVerificationDetails: zkpVerification ? {
                    verified: zkpVerification.verified,
                    timestamp: new Date().toISOString(),
                    method: 'issuer-node',
                    details: zkpVerification.details,
                    fullData: zkpVerification.verified ? {
                        verification: {
                            verified: true,
                            timestamp: new Date().toISOString(),
                            method: 'issuer-node-verification',
                            checks: {
                                structureValid: true,
                                issuerMatch: true,
                                subjectMatch: true,
                                notRevoked: zkpVerification.details?.notRevoked || false,
                                proofValid: zkpVerification.details?.zkpProof ? true : false
                            }
                        },
                        credential: credential,
                        zkpProof: zkpVerification.details?.zkpProof || null,
                        rawData: zkpVerification.rawData || null
                    } : null
                } : null
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
            zkpData: extractZkpDataFromCredential(credential, did),
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
        
        console.log('[Login] ✅ Contraseña correcta:', email);
        
        // ============================================
        // VERIFICACIÓN ZKP OBLIGATORIA para el login
        // ============================================
        console.log('[Login] 🔐 INICIANDO VERIFICACIÓN ZKP OBLIGATORIA...');
        
        if (!user.credential || !user.credential.credentialSubject) {
            console.error('[Login] ❌ Usuario no tiene credencial válida');
            console.error('[Login] ❌ Credential exists:', !!user.credential);
            console.error('[Login] ❌ CredentialSubject exists:', !!user.credential?.credentialSubject);
            return res.status(401).json({
                success: false,
                error: 'Tu cuenta no tiene una credencial ZKP válida registrada. La credencial es necesaria para autenticarte. Contacta al administrador del sistema.',
                reason: !user.credential ? 'NO_CREDENTIAL' : 'INVALID_CREDENTIAL_STRUCTURE',
                requiresCredential: true
            });
        }
        
        let zkpVerification = null;
        try {
            const issuerDID = user.credential.issuer || user.did;
            console.log('[Login] 📝 Verificando credencial contra Issuer Node...');
            console.log('[Login] 📝 Issuer DID:', issuerDID);
            console.log('[Login] 📝 Credential ID:', user.credential.id);
            
            zkpVerification = await verifyCredentialWithIssuer(
                user.credential,
                issuerDID,
                ISSUER_NODE_URL,
                issuerAuth
            );
            
            console.log('[Login] 📊 Resultado verificación:', zkpVerification);
            
            // ⚠️ CRÍTICO: Denegar acceso si la verificación ZKP falla
            if (!zkpVerification.verified) {
                console.error('[Login] ❌ VERIFICACIÓN ZKP FALLIDA - ACCESO DENEGADO');
                console.error('[Login] ❌ Razón:', zkpVerification.error || 'Credencial inválida');
                console.error('[Login] ❌ Stage:', zkpVerification.stage);
                console.error('[Login] ❌ Credential ID:', user.credential.id);
                
                let errorMessage = '🔐 Acceso denegado: Tu credencial ZKP no pasó la verificación. ';
                let detailsMessage = '';
                
                // Mensajes específicos según el tipo de error
                if (zkpVerification.stage === 'structure_validation') {
                    errorMessage += 'La estructura de la credencial no es válida.';
                    detailsMessage = 'La credencial no cumple con el formato W3C Verifiable Credential estándar.';
                } else if (zkpVerification.stage === 'issuer_node_connection') {
                    errorMessage += 'No se pudo contactar con el Issuer Node para verificar.';
                    detailsMessage = 'El servidor de verificación (Issuer Node) no está disponible. Intenta más tarde.';
                } else if (zkpVerification.stage === 'credential_retrieval') {
                    errorMessage += 'La credencial no existe en el Issuer Node.';
                    detailsMessage = 'Tu credencial no fue encontrada en el registro del emisor. Puede haber sido eliminada o nunca fue publicada correctamente.';
                } else if (zkpVerification.stage === 'revocation_check') {
                    errorMessage += 'La credencial ha sido revocada.';
                    detailsMessage = 'Tu credencial fue revocada por el emisor y ya no es válida para autenticación.';
                } else if (zkpVerification.stage === 'data_comparison') {
                    errorMessage += 'Los datos de la credencial no coinciden.';
                    detailsMessage = 'Los datos almacenados localmente no coinciden con los del Issuer Node.';
                } else {
                    errorMessage += 'Error desconocido en la verificación.';
                    detailsMessage = zkpVerification.error || 'La credencial no pudo ser verificada correctamente.';
                }
                
                return res.status(401).json({
                    success: false,
                    verified: false,
                    error: errorMessage,
                    details: detailsMessage,
                    technicalReason: zkpVerification.error,
                    stage: zkpVerification.stage,
                    credentialId: user.credential.id,
                    zkpVerificationFailed: true
                });
            }
            
            console.log('[Login] ✅ VERIFICACIÓN ZKP EXITOSA - ACCESO PERMITIDO ✓');
            
        } catch (error) {
            console.error('[Login] ❌ ERROR CRÍTICO en verificación ZKP:', error.message);
            console.error('[Login] ❌ Stack:', error.stack);
            console.error('[Login] ❌ Credential ID:', user.credential?.id);
            
            // Denegar acceso si hay error en la verificación
            return res.status(503).json({
                success: false,
                verified: false,
                error: '🔐 Error del servidor al verificar tu credencial ZKP.',
                details: 'Ocurrió un error técnico al intentar verificar tu credencial con el Issuer Node. El servicio de verificación puede estar temporalmente no disponible.',
                technicalError: error.message,
                solution: 'Por favor, intenta nuevamente en unos momentos. Si el problema persiste, contacta al administrador.',
                zkpVerificationError: true
            });
        }
        
        // ✅ Login permitido - Credencial ZKP verificada exitosamente
        console.log('[Login] ✅ LOGIN COMPLETO - Usuario autenticado con ZKP');
        
        // Devolver todos los datos del usuario (DID, credencial, etc.) + verificación ZKP
        res.json({
            success: true,
            message: 'Login exitoso',
            did: user.did,
            credential: user.credential, // Credencial completa W3C
            zkpData: user.zkpData,
            user: {
                name: user.name,
                email: user.email,
                did: user.did,
                type: 'email',
                state: user.accountState || 'active',
                authMethod: 'email',
                // Agregar resultado de verificación ZKP automática
                zkpVerified: zkpVerification?.verified || false,
                zkpVerificationDetails: zkpVerification ? {
                    verified: zkpVerification.verified,
                    timestamp: new Date().toISOString(),
                    method: 'issuer-node',
                    details: zkpVerification.details,
                    fullData: zkpVerification.verified ? {
                        verification: {
                            verified: true,
                            timestamp: new Date().toISOString(),
                            method: 'issuer-node-verification',
                            checks: {
                                structureValid: true,
                                issuerMatch: true,
                                subjectMatch: true,
                                notRevoked: zkpVerification.details?.notRevoked || false,
                                proofValid: zkpVerification.details?.zkpProof ? true : false
                            }
                        },
                        credential: user.credential,
                        zkpProof: zkpVerification.details?.zkpProof || null,
                        rawData: zkpVerification.rawData || null
                    } : null
                } : null
            },
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
            
            console.log('❌ Issuer Node no disponible');
            
            res.status(503).json({
                success: false,
                verified: false,
                error: 'Issuer Node no disponible. La verificación requiere el Issuer Node activo.',
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
                    method: 'issuer-node',
                    timestamp: new Date().toISOString(),
                    ...verificationResult.details
                },
                // Datos completos en formato JSON para mostrar
                fullData: {
                    verification: {
                        verified: true,
                        timestamp: new Date().toISOString(),
                        method: 'issuer-node-verification',
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
